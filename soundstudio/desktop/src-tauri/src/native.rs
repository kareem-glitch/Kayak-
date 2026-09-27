// The private link between the page and the native audio: a WebSocket on
// 127.0.0.1 with a random port and a random token (only this app's window
// knows both). One client at a time.
//
// Page -> app, text (JSON, with a request number `q` for replies):
//   {t:'start', input, output, channel} {t:'input', id} {t:'output', id} {t:'channel', ch}
//   {t:'devices'} {t:'mic', on} {t:'limit', samples} {t:'feel', name} {t:'gone', id} {t:'rec', on}
// Page -> app, binary: another player's block
//   [0]=3 [1]=id length [2]=planes, id bytes, then f32 little-endian samples per plane
// App -> page, binary (header padded so the samples start 8-byte aligned):
//   your block:   [0]=1 [1]=planes, [8..16] f64 captured-at (epoch ms), samples from 16
//   a recording:  [0]=2, [4..8] u32 n, [8..16] f64 heard-at of sample 0 (epoch ms), then mic n f32, out n f32
// App -> page, text: {t:'stats', ...} every 0.5 s, and replies {q, ok, ...}
use crate::audio::{self, Cmd, Out, Shared};
use serde_json::{json, Value};
use ssengine::blocks::InputChannel;
use ssengine::player::feel_named;
use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::protocol::Role;
use tungstenite::{Message, WebSocket};

type Writer = Arc<Mutex<Option<WebSocket<TcpStream>>>>;

pub fn serve() -> std::io::Result<(u16, String)> {
    let token = format!("{:016x}{:016x}", RandomState::new().hash_one(1u8), RandomState::new().hash_one(std::process::id()));
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let (out_tx, out_rx) = crossbeam_channel::unbounded::<Out>();
    let shared = Shared::new(out_tx);
    let writer: Writer = Arc::new(Mutex::new(None));
    { let (w, sh) = (writer.clone(), shared.clone()); std::thread::spawn(move || hub(out_rx, w, sh)); }
    let tok = token.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (w, sh, tok) = (writer.clone(), shared.clone(), tok.clone());
            std::thread::spawn(move || { if let Err(e) = client(stream, &tok, w, sh) { eprintln!("audio link closed: {e}"); } });
        }
    });
    Ok((port, token))
}

fn client(stream: TcpStream, token: &str, writer: Writer, sh: Arc<Shared>) -> Result<(), String> {
    stream.set_nodelay(true).ok();
    let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        if req.uri().query().map_or(false, |q| q.split('&').any(|kv| kv == format!("t={token}"))) { Ok(resp) }
        else { Err(Response::builder().status(403).body(None).unwrap()) }
    };
    let write_half = stream.try_clone().map_err(|e| e.to_string())?;
    let mut ws = tungstenite::accept_hdr(stream, check).map_err(|e| e.to_string())?;
    *writer.lock().unwrap() = Some(WebSocket::from_raw_socket(write_half, Role::Server, None));
    let mut a = Session { input: None, output: None, in_name: String::new(), out_name: String::new(), in_chans: 1, channel: InputChannel::One, sh: sh.clone() };
    loop {
        let msg = match ws.read() { Ok(m) => m, Err(_) => break };
        if msg.is_binary() {
            let b = msg.into_data();
            if b.len() > 3 && b[0] == 3 { deliver(&b, &sh); }
        } else if msg.is_text() {
            let v: Value = match serde_json::from_str(msg.to_text().unwrap_or("")) { Ok(v) => v, Err(_) => continue };
            let reply = a.handle(&v);
            if let (Some(q), Some(mut r)) = (v.get("q"), reply) { r["q"] = q.clone(); let _ = sh.out_tx.send(Out::Text(r.to_string())); }
        } else if msg.is_close() { break; }
    }
    sh.rec.store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())   // dropping the session stops its streams
}

fn deliver(b: &[u8], sh: &Shared) {
    let (idn, planes) = (b[1] as usize, b[2] as usize);
    if planes == 0 || b.len() < 3 + idn { return; }
    let id = String::from_utf8_lossy(&b[3..3 + idn]).to_string();
    let samples: Vec<f32> = b[3 + idn..].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let n = samples.len() / planes; if n == 0 { return; }
    let left = samples[..n].to_vec();
    let right = if planes > 1 { Some(samples[n..2 * n].to_vec()) } else { None };
    let _ = sh.cmd_tx.send(Cmd::Deliver(id, left, right));
}

struct Session { input: Option<cpal::Stream>, output: Option<cpal::Stream>, in_name: String, out_name: String, in_chans: u16, channel: InputChannel, sh: Arc<Shared> }

impl Session {
    fn open_input(&mut self, id: &str) -> Result<(), String> {
        self.input = None;
        let (s, name, ch) = audio::start_input(id, self.channel, &self.sh)?;
        self.input = Some(s); self.in_name = name; self.in_chans = ch; Ok(())
    }
    fn open_output(&mut self, id: &str) -> Result<(), String> {
        self.output = None;
        let (s, name) = audio::start_output(id, &self.sh)?;
        self.output = Some(s); self.out_name = name; Ok(())
    }
    fn state(&self) -> Value { json!({ "ok": true, "input": self.in_name, "output": self.out_name, "inChannels": self.in_chans }) }
    fn handle(&mut self, v: &Value) -> Option<Value> {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let res = match v.get("t").and_then(|t| t.as_str()).unwrap_or("") {
            "start" => { self.channel = InputChannel::parse(&s("channel")); self.open_output(&s("output")).and_then(|_| self.open_input(&s("input"))).map(|_| self.state()) }
            "input" => self.open_input(&s("id")).map(|_| self.state()),
            "output" => self.open_output(&s("id")).map(|_| self.state()),
            "channel" => { self.channel = InputChannel::parse(&s("ch")); let id = self.in_name.clone(); self.open_input(&id).map(|_| self.state()) }
            "devices" => {
                let (ins, outs) = audio::devices();
                let list = |d: Vec<(String, u16)>| d.into_iter().map(|(n, c)| json!({ "id": n, "label": n, "channels": c })).collect::<Vec<_>>();
                Ok(json!({ "ok": true, "inputs": list(ins), "outputs": list(outs) }))
            }
            "mic" => { self.sh.set_mic(v.get("on").and_then(|x| x.as_bool()).unwrap_or(true)); return None; }
            "limit" => { let n = v.get("samples").and_then(|x| x.as_f64()).unwrap_or(1024.0); *self.sh.limit.lock().unwrap() = n; let _ = self.sh.cmd_tx.send(Cmd::Limit(n)); return None; }
            "feel" => { let f = feel_named(&s("name")); *self.sh.feel.lock().unwrap() = f; let _ = self.sh.cmd_tx.send(Cmd::Feel(f)); return None; }
            "gone" => { let _ = self.sh.cmd_tx.send(Cmd::Gone(s("id"))); return None; }
            "rec" => {
                let on = v.get("on").and_then(|x| x.as_bool()).unwrap_or(false);
                if on { let _ = self.sh.out_tx.send(Out::RecStart); }
                self.sh.rec.store(on, std::sync::atomic::Ordering::Relaxed);
                if !on { let _ = self.sh.out_tx.send(Out::RecStop); }
                return None;
            }
            _ => return None,
        };
        Some(res.unwrap_or_else(|e| json!({ "ok": false, "error": e })))
    }
}

/// Everything going to the page passes through here, in order: your blocks,
/// replies, stats, and recordings (which are assembled here, off the audio threads).
fn hub(rx: crossbeam_channel::Receiver<Out>, writer: Writer, sh: Arc<Shared>) {
    let mut mics: Vec<(f64, Vec<f32>)> = vec![];
    let mut outs: Vec<(f64, Vec<f32>)> = vec![];
    let mut last_stats = Instant::now();
    let send = |m: Message| { let mut g = writer.lock().unwrap(); if let Some(ws) = g.as_mut() { if ws.send(m).is_err() { *g = None; } } };
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Out::Block { at_ms, planes }) => {
                let mut b = vec![0u8; 16]; b[0] = 1; b[1] = planes.len() as u8; b[8..16].copy_from_slice(&at_ms.to_le_bytes());
                for p in &planes { for x in p { b.extend_from_slice(&x.to_le_bytes()); } }
                send(Message::Binary(b.into()));
            }
            Ok(Out::Text(t)) => send(Message::Text(t.into())),
            Ok(Out::RecStart) => { mics.clear(); outs.clear(); }
            Ok(Out::RecMic { at_ms, data }) => mics.push((at_ms, data)),
            Ok(Out::RecOut { at_ms, data }) => outs.push((at_ms, data)),
            Ok(Out::RecStop) => {
                let heard = outs.first().map_or(0.0, |o| o.0);
                let out: Vec<f32> = outs.drain(..).flat_map(|o| o.1).collect();
                // mic placed on the same timeline: sample j is what reached the mic at heard + j
                let mut mic = vec![0f32; out.len()];
                for (at, d) in mics.drain(..) {
                    let j0 = ((at - heard) * ssengine::RATE as f64 / 1000.0).round() as i64;
                    for (k, x) in d.iter().enumerate() { let j = j0 + k as i64; if j >= 0 && (j as usize) < mic.len() { mic[j as usize] = *x; } }
                }
                let mut b = vec![0u8; 16]; b[0] = 2; b[4..8].copy_from_slice(&(out.len() as u32).to_le_bytes()); b[8..16].copy_from_slice(&heard.to_le_bytes());
                for x in mic.iter().chain(out.iter()) { b.extend_from_slice(&x.to_le_bytes()); }
                send(Message::Binary(b.into()));
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(_) => return,
        }
        if last_stats.elapsed() >= Duration::from_millis(500) {
            last_stats = Instant::now();
            let st = sh.stats.lock().unwrap().clone();
            let players: serde_json::Map<String, Value> = st.players.iter().map(|p| (p.id.clone(), json!({ "bufferMs": (p.buffer_ms * 10.0).round() / 10.0, "rate": p.rate, "under": p.under }))).collect();
            send(Message::Text(json!({ "t": "stats", "under": st.under, "players": players, "peak": sh.take_peak(), "inLat": sh.in_lat(), "outLat": sh.out_lat() }).to_string().into()));
        }
    }
}
