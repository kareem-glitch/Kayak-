// Direct audio between two desktop apps over UDP: the fast lane. The page sets
// it up (it swaps addresses and tokens over the room's control channel) and
// keeps WebRTC as the backup; once a path works both ways, audio goes app to
// app without the web view, in 64-frame (1.3 ms) packets.
//
//  - one UDP socket for everything: STUN (to learn our public address), probes
//    (hole punching: both sides send until one gets through), and audio
//  - incoming audio goes straight into the mixer while the room is a free jam
//    (direct play), and a copy always goes to the page (levels, recording, and
//    BARS, where the page decides when each block plays)
//  - lost blocks (up to 4 in a row) are filled in, as on the browser path
// Wire format: ssengine::direct.
use crate::audio::{epoch_ms, Cmd, Out, Shared};
use serde_json::json;
use ssengine::direct::{self as wire, Packet};
use std::collections::HashMap;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_FILL: i64 = 4;
const PUNCH_EVERY: Duration = Duration::from_millis(40);
const KEEPALIVE: Duration = Duration::from_millis(500);
const TIMEOUT: Duration = Duration::from_millis(2000);
const STUN_SERVERS: [&str; 2] = ["stun.l.google.com:19302", "stun.cloudflare.com:3478"];

struct Peer {
    token: u64, addrs: Vec<SocketAddr>, to: Option<SocketAddr>,
    send_ok: bool, recv_ok: bool, last_rx: Option<Instant>, last_tx: Option<Instant>,
    last_seq: Option<u32>, last: Option<Vec<Vec<f32>>>, gain: f32, told: (bool, bool),
}

pub struct Direct {
    sock: UdpSocket, pub token: u64, port: u16,
    peers: Mutex<HashMap<String, Peer>>,
    public: Mutex<Option<SocketAddr>>, stun_tx: Mutex<([u8; 12], Option<Instant>)>,
    play: AtomicBool, bits: AtomicU8, clk_off: AtomicU64, seq: AtomicU32,
    /// echo test (latency measurement): send each player's audio straight back, none of yours
    echo: AtomicBool,
    sh: Arc<Shared>,
}

impl Direct {
    pub fn start(sh: Arc<Shared>) -> std::io::Result<Arc<Direct>> {
        let sock = UdpSocket::bind("0.0.0.0:0")?;
        sock.set_read_timeout(Some(Duration::from_millis(20)))?;
        let port = sock.local_addr()?.port();
        let token = loop { let t = random_u64(); if t != 0 { break t; } };
        let d = Arc::new(Direct { sock, token, port, peers: Mutex::new(HashMap::new()), public: Mutex::new(None), stun_tx: Mutex::new(([0; 12], None)),
            play: AtomicBool::new(true), bits: AtomicU8::new(16), clk_off: AtomicU64::new(0f64.to_bits()), seq: AtomicU32::new(0), echo: AtomicBool::new(false), sh });
        { let d = d.clone(); std::thread::spawn(move || d.receive()); }
        { let d = d.clone(); std::thread::spawn(move || d.timer()); }
        { let d = d.clone(); let blocks = d.sh.direct_rx.clone(); std::thread::spawn(move || for (planes, at) in blocks { d.send_audio(&planes, at); }); }
        Ok(d)
    }

    /// Our addresses for the other side to try: this computer on the local network
    /// (and itself, for two apps on one machine), and the public one from STUN.
    pub fn candidates(&self) -> Vec<String> {
        let mut v = vec![];
        if let Some(ip) = lan_ip() { v.push(SocketAddr::new(ip, self.port).to_string()); }
        if let Some(p) = *self.public.lock().unwrap() { v.push(p.to_string()); }
        v.push(format!("127.0.0.1:{}", self.port));
        v
    }
    /// Wait (briefly) for STUN so the public address is in the first answer.
    pub fn candidates_soon(&self) -> Vec<String> {
        let t = Instant::now();
        while self.public.lock().unwrap().is_none() && t.elapsed() < Duration::from_millis(800) { std::thread::sleep(Duration::from_millis(20)); }
        self.candidates()
    }

    pub fn add_peer(&self, id: &str, token: u64, addrs: &[String]) {
        let addrs: Vec<SocketAddr> = addrs.iter().filter_map(|a| a.parse().ok()).filter(|a: &SocketAddr| a.is_ipv4()).collect();
        self.peers.lock().unwrap().insert(id.to_string(), Peer { token, addrs, to: None, send_ok: false, recv_ok: false, last_rx: None, last_tx: None, last_seq: None, last: None, gain: 1.0, told: (false, false) });
    }
    pub fn forget(&self, id: &str) { self.peers.lock().unwrap().remove(id); self.update_active(); }
    pub fn forget_all(&self) { self.peers.lock().unwrap().clear(); self.update_active(); }
    pub fn set_play(&self, on: bool) { self.play.store(on, Relaxed); }
    pub fn set_echo(&self, on: bool) { self.echo.store(on, Relaxed); }
    pub fn set_bits(&self, bits: u8) { self.bits.store(if bits == 32 { 32 } else { 16 }, Relaxed); }
    pub fn set_gain(&self, id: &str, g: f32) { if let Some(p) = self.peers.lock().unwrap().get_mut(id) { p.gain = g; } }
    /// The page's clock minus wall-clock time (ms): packets carry page-clock times.
    pub fn set_clock(&self, off: f64) { self.clk_off.store(off.to_bits(), Relaxed); }
    /// Any peer reachable: only then does your input make direct blocks (Shared::direct_active).
    fn update_active(&self) { let any = self.peers.lock().unwrap().values().any(|p| p.send_ok); self.sh.direct_active.store(any, Relaxed); }

    /// One block of your input (wall-clock ms when it was ready) to everyone reachable.
    fn send_audio(&self, planes: &[Vec<f32>], at_ms: f64) {
        if self.echo.load(Relaxed) { return; }   // echo test: only the others' audio goes back
        let targets: Vec<SocketAddr> = self.peers.lock().unwrap().values().filter(|p| p.send_ok).filter_map(|p| p.to).collect();
        if targets.is_empty() { return; }
        let pkt = wire::encode(&Packet { kind: wire::AUDIO, token: self.token, seq: self.seq.fetch_add(1, Relaxed), time_ms: at_ms + f64::from_bits(self.clk_off.load(Relaxed)), bits: self.bits.load(Relaxed), planes: planes.to_vec() });
        for t in targets { let _ = self.sock.send_to(&pkt, t); }
    }

    fn probe(&self, kind: u8, to: SocketAddr) {
        let _ = self.sock.send_to(&wire::encode(&Packet { kind, token: self.token, seq: 0, time_ms: 0.0, bits: 16, planes: vec![] }), to);
    }

    fn receive(&self) {
        let mut buf = [0u8; 4096];
        loop {
            let (n, from) = match self.sock.recv_from(&mut buf) { Ok(x) => x, Err(_) => continue };
            let b = &buf[..n];
            if wire::is_stun(b) {
                let tx = self.stun_tx.lock().unwrap().0;
                if let Some(a) = wire::stun_mapped(b, tx) { *self.public.lock().unwrap() = Some(SocketAddr::V4(a)); }
                continue;
            }
            let Some(p) = wire::decode(b) else { continue };
            let mut peers = self.peers.lock().unwrap();
            let Some((id, peer)) = peers.iter_mut().find(|(_, x)| x.token == p.token) else { continue };
            let id = id.clone();
            peer.last_rx = Some(Instant::now()); peer.recv_ok = true;
            match p.kind {
                wire::PROBE => { drop(peers); self.probe(wire::ANSWER, from); self.mark_reachable(&id, from); }
                wire::ANSWER => { drop(peers); self.mark_reachable(&id, from); }
                _ if self.echo.load(Relaxed) => {
                    drop(peers);
                    let back = wire::encode(&Packet { kind: wire::AUDIO, token: self.token, seq: self.seq.fetch_add(1, Relaxed), time_ms: epoch_ms() + f64::from_bits(self.clk_off.load(Relaxed)), bits: 16, planes: p.planes });
                    let _ = self.sock.send_to(&back, from);
                }
                _ => {
                    // audio: fill gaps, play now (free jam), and give the page a copy
                    let gap = match peer.last_seq { Some(s) => wire::seq_delta(s, p.seq), None => 1 };
                    if gap <= 0 { continue; }
                    peer.last_seq = Some(p.seq);
                    let gain = peer.gain;
                    let fill = if gap > 1 && gap - 1 <= MAX_FILL { peer.last.as_ref().map(|l| wire::conceal(l, (gap - 1) as usize)) } else { None };
                    peer.last = Some(p.planes.clone());
                    drop(peers);
                    if self.play.load(Relaxed) {
                        for f in fill.into_iter().flatten().chain(std::iter::once(p.planes.clone())) {
                            let scale = |v: &Vec<f32>| v.iter().map(|x| x * gain).collect::<Vec<f32>>();
                            let _ = self.sh.cmd_tx.send(Cmd::Deliver(id.clone(), scale(&f[0]), f.get(1).map(scale)));
                        }
                    }
                    let _ = self.sh.out_tx.send(Out::Remote { id, seq: p.seq, time_ms: p.time_ms, rx_ms: epoch_ms(), bits: p.bits, planes: p.planes });
                }
            }
        }
    }

    fn mark_reachable(&self, id: &str, from: SocketAddr) {
        if let Some(p) = self.peers.lock().unwrap().get_mut(id) { p.send_ok = true; p.to = Some(from); }   // the address that answered is the one that works
        self.update_active();
    }

    /// Every few ms: punch (probe every candidate until one answers), keep alive,
    /// notice a path that died, ask STUN for our public address, tell the page.
    fn timer(&self) {
        let mut last_stun = Instant::now() - Duration::from_secs(60);
        loop {
            std::thread::sleep(PUNCH_EVERY);
            if self.public.lock().unwrap().is_none() && last_stun.elapsed() > Duration::from_secs(3) || last_stun.elapsed() > Duration::from_secs(25) {
                last_stun = Instant::now();
                let tx: [u8; 12] = { let a = random_u64().to_le_bytes(); let b = random_u64().to_le_bytes(); let mut t = [0u8; 12]; t[..8].copy_from_slice(&a); t[8..].copy_from_slice(&b[..4]); t };
                *self.stun_tx.lock().unwrap() = (tx, Some(Instant::now()));
                for s in STUN_SERVERS { if let Some(a) = s.to_socket_addrs().ok().and_then(|mut i| i.find(|a| a.is_ipv4())) { let _ = self.sock.send_to(&wire::stun_request(tx), a); } }
            }
            let mut sends = vec![]; let mut changes = vec![];
            {
                let mut peers = self.peers.lock().unwrap();
                for (id, p) in peers.iter_mut() {
                    if p.last_rx.map_or(false, |t| t.elapsed() > TIMEOUT) { p.recv_ok = false; p.send_ok = false; p.to = None; p.last_rx = None; p.last_seq = None; }
                    if !p.send_ok { sends.extend(p.addrs.iter().map(|a| (*a, wire::PROBE))); }
                    else if p.last_tx.map_or(true, |t| t.elapsed() > KEEPALIVE) { if let Some(t) = p.to { sends.push((t, wire::PROBE)); p.last_tx = Some(Instant::now()); } }
                    if p.told != (p.send_ok, p.recv_ok) { p.told = (p.send_ok, p.recv_ok); changes.push((id.clone(), p.send_ok, p.recv_ok)); }
                }
            }
            for (a, k) in sends { self.probe(k, a); }
            if !changes.is_empty() { self.update_active(); }
            for (id, send, recv) in changes { let _ = self.sh.out_tx.send(Out::Text(json!({ "t": "direct", "id": id, "send": send, "recv": recv }).to_string())); }
        }
    }
}

/// This computer's address on the local network (the one it would use to reach the internet).
fn lan_ip() -> Option<std::net::IpAddr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?; s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip()).filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
}
fn random_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossbeam_channel::unbounded;

    fn app() -> (Arc<Direct>, Arc<Shared>, crossbeam_channel::Receiver<Out>, crossbeam_channel::Sender<(Vec<Vec<f32>>, f64)>) {
        let (out_tx, out_rx) = unbounded(); let sh = Shared::new(out_tx);
        let btx = sh.direct_tx.clone();
        (Direct::start(sh.clone()).unwrap(), sh, out_rx, btx)
    }

    #[test]
    fn two_apps_find_each_other_and_audio_flows_both_ways() {
        let (a, sha, outa, blocks_a) = app();
        let (b, shb, outb, _blocks_b) = app();
        let local = |d: &Arc<Direct>| d.candidates().into_iter().filter(|c| c.starts_with("127.")).collect::<Vec<_>>();
        a.add_peer("bob", b.token, &local(&b)); b.add_peer("ann", a.token, &local(&a));
        let t = Instant::now();
        while !(a.sh.direct_active.load(Relaxed) && b.sh.direct_active.load(Relaxed)) { assert!(t.elapsed() < Duration::from_secs(3), "path set up"); std::thread::sleep(Duration::from_millis(10)); }
        // the page heard about it
        let told = |rx: &crossbeam_channel::Receiver<Out>| rx.try_iter().any(|o| matches!(o, Out::Text(ref s) if s.contains("\"direct\"") && s.contains("\"send\":true")));
        std::thread::sleep(Duration::from_millis(100));
        assert!(told(&outa) && told(&outb));
        // Ann plays: Bob's mixer gets it (free jam) and Bob's page gets a copy
        a.set_clock(5.0);
        for i in 0..10 { blocks_a.send((vec![vec![0.25; 64]], 1000.0 + i as f64)).unwrap(); }
        std::thread::sleep(Duration::from_millis(200));
        let delivered = shb.cmd_rx.try_iter().filter(|c| matches!(c, Cmd::Deliver(id, l, _) if id == "ann" && l.len() == 64)).count();
        assert_eq!(delivered, 10, "straight into the mixer");
        let copies: Vec<_> = outb.try_iter().filter_map(|o| match o { Out::Remote { id, time_ms, .. } if id == "ann" => Some(time_ms), _ => None }).collect();
        assert_eq!(copies.len(), 10); assert_eq!(copies[0], 1005.0, "times on the sender's page clock");
        let _ = sha;
    }

    #[test]
    fn bars_mode_leaves_playing_to_the_page_and_gaps_are_filled() {
        let (a, _sha, _outa, blocks_a) = app();
        let (b, shb, outb, _bb) = app();
        let local = |d: &Arc<Direct>| d.candidates().into_iter().filter(|c| c.starts_with("127.")).collect::<Vec<_>>();
        a.add_peer("bob", b.token, &local(&b)); b.add_peer("ann", a.token, &local(&a));
        let t = Instant::now();
        while !a.sh.direct_active.load(Relaxed) { assert!(t.elapsed() < Duration::from_secs(3)); std::thread::sleep(Duration::from_millis(10)); }
        b.set_play(false);
        blocks_a.send((vec![vec![0.5; 64]], 0.0)).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(shb.cmd_rx.try_iter().filter(|c| matches!(c, Cmd::Deliver(..))).count(), 0, "BARS: the page decides");
        assert!(outb.try_iter().any(|o| matches!(o, Out::Remote { .. })));
        // a lost packet (sequence skips one): filled in when playing directly
        b.set_play(true);
        a.seq.fetch_add(1, Relaxed);
        blocks_a.send((vec![vec![0.5; 64]], 0.0)).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(shb.cmd_rx.try_iter().filter(|c| matches!(c, Cmd::Deliver(..))).count(), 2, "the lost block filled, then the real one");
    }

    #[test]
    fn echo_test_sends_audio_straight_back() {
        let (a, _sha, outa, blocks_a) = app();
        let (b, _shb, _outb, _bb) = app();
        let local = |d: &Arc<Direct>| d.candidates().into_iter().filter(|c| c.starts_with("127.")).collect::<Vec<_>>();
        a.add_peer("bob", b.token, &local(&b)); b.add_peer("ann", a.token, &local(&a));
        let t = Instant::now();
        while !(a.sh.direct_active.load(Relaxed) && b.sh.direct_active.load(Relaxed)) { assert!(t.elapsed() < Duration::from_secs(3)); std::thread::sleep(Duration::from_millis(10)); }
        b.set_echo(true);
        for _ in 0..5 { blocks_a.send((vec![vec![0.5; 64]], 0.0)).unwrap(); }
        std::thread::sleep(Duration::from_millis(200));
        let back = outa.try_iter().filter(|o| matches!(o, Out::Remote { id, planes, .. } if id == "bob" && (planes[0][0] - 0.5).abs() < 0.001)).count();
        assert_eq!(back, 5, "Ann hears her own audio back from Bob");
    }
}
