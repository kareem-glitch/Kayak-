// Native audio: the input and output streams and what their callbacks do.
//  input callback:  device samples -> 128-frame blocks of your chosen channel(s),
//                   time-stamped, sent to the page (which sends them to the room)
//  output callback: other players' audio -> adaptive buffers -> mix -> device
// Callbacks never wait on locks held elsewhere: they talk to the rest of the app
// through channels and atomics.
use crossbeam_channel::{Receiver, Sender};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Device, FromSample, SampleFormat, SampleRate, SizedSample, Stream, StreamConfig, SupportedBufferSize};
use ssengine::blocks::{peak, Blocker, InputChannel};
use ssengine::mixer::{Mixer, PlayerStats};
use ssengine::player::{Feel, TIGHT};
use ssengine::resample::{RateOut, Resampler};
use ssengine::RATE;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Smallest device buffer we ask for, in frames (1.3 ms at 48 kHz).
const WANT_BUFFER: u32 = 64;

pub enum Cmd { Deliver(String, Vec<f32>, Option<Vec<f32>>), Gone(String), Limit(f64), Feel(Feel) }
pub enum Out {
    Block { at_ms: f64, planes: Vec<Vec<f32>> },
    /// Another app's audio that came in directly (direct.rs), for the page.
    Remote { id: String, seq: u32, time_ms: f64, rx_ms: f64, bits: u8, planes: Vec<Vec<f32>> },
    RecStart, RecMic { at_ms: f64, data: Vec<f32> }, RecOut { at_ms: f64, data: Vec<f32> }, RecStop,
    Text(String),
}

#[derive(Default, Clone)]
pub struct Stats { pub under: u32, pub players: Vec<PlayerStats> }

pub struct Shared {
    pub cmd_tx: Sender<Cmd>, pub cmd_rx: Receiver<Cmd>,
    pub out_tx: Sender<Out>,
    mic_gain: AtomicU32, peak: AtomicU32, in_lat: AtomicU32, out_lat: AtomicU32,
    pub rec: AtomicBool,
    /// The air.band plugin is streaming your DAW's audio: it's your input (see plugin.rs).
    pub plugin_live: AtomicBool,
    /// Your input channel choice (InputChannel as a number), for the plugin input too.
    pub channel: AtomicU32,
    pub stats: Mutex<Stats>,
    pub limit: Mutex<f64>, pub feel: Mutex<Feel>,
    /// Your input for the direct app-to-app path (direct.rs): 64-frame blocks and
    /// when each was ready (wall-clock ms), only while some peer is reachable.
    pub direct_tx: Sender<(Vec<Vec<f32>>, f64)>, pub direct_rx: Receiver<(Vec<Vec<f32>>, f64)>,
    pub direct_active: AtomicBool,
}
fn f(a: &AtomicU32) -> f32 { f32::from_bits(a.load(Relaxed)) }
fn set(a: &AtomicU32, v: f32) { a.store(v.to_bits(), Relaxed) }
pub fn epoch_ms() -> f64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0) }

impl Shared {
    pub fn new(out_tx: Sender<Out>) -> Arc<Self> {
        let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded();
        let (direct_tx, direct_rx) = crossbeam_channel::bounded(512);
        Arc::new(Shared { cmd_tx, cmd_rx, out_tx, mic_gain: AtomicU32::new(1f32.to_bits()), peak: AtomicU32::new(0),
            in_lat: AtomicU32::new(0), out_lat: AtomicU32::new(0), rec: AtomicBool::new(false), plugin_live: AtomicBool::new(false), channel: AtomicU32::new(0),
            stats: Mutex::new(Stats::default()), limit: Mutex::new(8.0 * 128.0), feel: Mutex::new(TIGHT), direct_tx, direct_rx, direct_active: AtomicBool::new(false) })
    }
    pub fn set_mic(&self, on: bool) { set(&self.mic_gain, if on { 1.0 } else { 0.0 }) }
    pub fn in_lat(&self) -> f32 { f(&self.in_lat) }
    pub fn out_lat(&self) -> f32 { f(&self.out_lat) }
    pub fn mic_gain(&self) -> f32 { f(&self.mic_gain) }
    pub fn set_in_lat(&self, ms: f32) { set(&self.in_lat, ms) }
    /// Note an input level for the meter (keeps the loudest until read).
    pub fn note_peak(&self, v: f32) { if v > f(&self.peak) { set(&self.peak, v) } }
    pub fn set_channel(&self, c: InputChannel) { self.channel.store(c as u32, Relaxed) }
    pub fn channel(&self) -> InputChannel { match self.channel.load(Relaxed) { 1 => InputChannel::Two, 2 => InputChannel::Mix, 3 => InputChannel::Stereo, _ => InputChannel::One } }
    /// Loudest input sample since the last call.
    pub fn take_peak(&self) -> f32 { f32::from_bits(self.peak.swap(0, Relaxed)) }
}

fn name(d: &Device) -> String { d.name().unwrap_or_else(|_| "Unknown device".into()) }

/// The audio systems to use. On Windows, ASIO first: an interface's own driver,
/// which skips Windows' audio mixer (10-30 ms less delay) and uses the buffer
/// size set in the interface's control panel. Then the standard system.
fn hosts() -> Vec<(cpal::Host, bool)> {
    #[allow(unused_mut)]
    let mut v = vec![];
    #[cfg(windows)]
    if let Ok(h) = cpal::host_from_id(cpal::HostId::Asio) { v.push((h, true)); }
    v.push((cpal::default_host(), false));
    v
}
/// What the page shows and sends back as the device id.
fn label(d: &Device, asio: bool) -> String { if asio { format!("{} (ASIO)", name(d)) } else { name(d) } }
pub fn is_asio(label: &str) -> bool { label.ends_with(" (ASIO)") }
/// Catch-all ASIO drivers (wrappers around Windows audio, onboard sound): no gain, so never picked on their own.
fn generic_asio(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    ["asio4all", "flexasio", "asio2wasapi", "realtek", "generic", "voicemeeter"].iter().any(|g| n.contains(g))
}
fn list(h: &cpal::Host, input: bool) -> Vec<Device> {
    (if input { h.input_devices().map(|i| i.collect()) } else { h.output_devices().map(|i| i.collect()) }).unwrap_or_default()
}

/// (label, channels) of every input and output device.
pub fn devices() -> (Vec<(String, u16)>, Vec<(String, u16)>) {
    let (mut ins, mut outs) = (vec![], vec![]);
    for (h, asio) in hosts() {
        for (input, out) in [(true, &mut ins), (false, &mut outs)] {
            for d in list(&h, input) {
                let ch = pick(&d, input).map(|(c, _)| c.channels).unwrap_or(0);
                if ch > 0 { out.push((label(&d, asio), ch)); }
            }
        }
    }
    (ins, outs)
}

/// The device with this label. Empty (or not found): an audio interface's own
/// ASIO driver if there is one, else the system default. The bool: it's ASIO.
pub fn find(id: &str, input: bool) -> Option<(Device, bool)> {
    let hs = hosts();
    if !id.is_empty() {
        for (h, asio) in &hs { if let Some(d) = list(h, input).into_iter().find(|d| label(d, *asio) == id) { return Some((d, *asio)); } }
    }
    for (h, asio) in &hs {
        if *asio { if let Some(d) = list(h, input).into_iter().find(|d| !generic_asio(&name(d))) { return Some((d, true)); } }
    }
    system_default(input)
}
fn system_default(input: bool) -> Option<(Device, bool)> {
    let h = cpal::default_host();
    (if input { h.default_input_device() } else { h.default_output_device() }).map(|d| (d, false))
}

/// A 48 kHz config with up to 2 channels (prefer 2), float samples if offered,
/// and the smallest buffer the device allows (down to WANT_BUFFER).
fn pick(d: &Device, input: bool) -> Result<(StreamConfig, SampleFormat), String> {
    let ranges: Vec<_> = if input { d.supported_input_configs().map_err(|e| e.to_string())?.collect() } else { d.supported_output_configs().map_err(|e| e.to_string())?.collect() };
    // 48 kHz if the device offers it; otherwise the nearest rate it runs at, converted
    // to and from 48 kHz (resample.rs), rather than no sound at all
    let rate_of = |r: &cpal::SupportedStreamConfigRange| RATE.clamp(r.min_sample_rate().0, r.max_sample_rate().0);
    let best = ranges.into_iter().max_by_key(|r| {
        let ch = r.channels();
        let ch_score = if ch == 2 { 3 } else if ch == 1 { 2 } else { 1 };   // 2 best, then mono, then multichannel
        let fmt_score = match r.sample_format() { SampleFormat::F32 => 4, SampleFormat::F64 | SampleFormat::I32 => 3, SampleFormat::I24 => 2, SampleFormat::I16 => 1, _ => 0 };
        (std::cmp::Reverse(rate_of(r).abs_diff(RATE)), ch_score, fmt_score)
    }).ok_or_else(|| format!("{} has no usable audio format.", name(d)))?;
    let rate = rate_of(&best);
    let buffer_size = match best.buffer_size() { SupportedBufferSize::Range { min, max } => BufferSize::Fixed((WANT_BUFFER * rate / RATE).clamp(*min, *max)), SupportedBufferSize::Unknown => BufferSize::Default };
    Ok((StreamConfig { channels: best.channels(), sample_rate: SampleRate(rate), buffer_size }, best.sample_format()))
}

fn err_fn(e: cpal::StreamError) { eprintln!("audio stream error: {e}") }

/// Start the input stream. Returns the stream, the device's label and channel count.
pub fn start_input(id: &str, channel: InputChannel, sh: &Arc<Shared>) -> Result<(Stream, String, u16), String> {
    let (d, asio) = find(id, true).ok_or("No microphone or audio input found.")?;
    match open_input(&d, asio, channel, sh) {
        // an ASIO driver we picked ourselves can be busy (e.g. a DAW has it): use the system's audio instead
        Err(e) if asio && id.is_empty() => { eprintln!("ASIO input unavailable ({e}), using the system default"); let (d, _) = system_default(true).ok_or(e)?; open_input(&d, false, channel, sh) }
        r => r,
    }
}
fn open_input(d: &Device, asio: bool, channel: InputChannel, sh: &Arc<Shared>) -> Result<(Stream, String, u16), String> {
    let (mut cfg, fmt) = pick(d, true)?;
    let build = |cfg: &StreamConfig| match fmt {
        SampleFormat::F32 => input::<f32>(d, cfg, channel, sh.clone()),
        SampleFormat::F64 => input::<f64>(d, cfg, channel, sh.clone()),
        SampleFormat::I32 => input::<i32>(d, cfg, channel, sh.clone()),
        SampleFormat::I24 => input::<cpal::I24>(d, cfg, channel, sh.clone()),
        SampleFormat::I16 => input::<i16>(d, cfg, channel, sh.clone()),
        SampleFormat::U16 => input::<u16>(d, cfg, channel, sh.clone()),
        other => Err(format!("Unsupported sample format {other:?}")),
    };
    let s = build(&cfg).or_else(|_| { cfg.buffer_size = BufferSize::Default; build(&cfg) })?;
    s.play().map_err(|e| e.to_string())?;
    Ok((s, label(d, asio), cfg.channels))
}

fn input<T: SizedSample>(d: &Device, cfg: &StreamConfig, channel: InputChannel, sh: Arc<Shared>) -> Result<Stream, String> where f32: FromSample<T> {
    let chans = cfg.channels as usize;
    let mut blocker = Blocker::new(channel);
    let mut fast = Blocker::with_size(channel, 64);   // the direct path's smaller packets
    let mut buf: Vec<f32> = Vec::with_capacity(8192);
    let mut rs = (cfg.sample_rate.0 != RATE).then(|| Resampler::new(cfg.sample_rate.0, RATE, chans));
    let mut buf48: Vec<f32> = Vec::with_capacity(8192);
    d.build_input_stream(cfg, move |data: &[T], info: &cpal::InputCallbackInfo| {
        if sh.plugin_live.load(Relaxed) { return; }   // your DAW (through the plugin) is the input right now
        buf.clear(); buf.extend(data.iter().map(|s| <f32 as FromSample<T>>::from_sample_(*s)));
        if let Some(rs) = rs.as_mut() {   // device isn't at 48 kHz: convert
            rs.push(&buf); buf48.resize(rs.available() * chans, 0.0);
            let k = rs.pull(&mut buf48); buf48.truncate(k * chans); std::mem::swap(&mut buf, &mut buf48);
        }
        let ts = info.timestamp();
        let lat = ts.callback.duration_since(&ts.capture).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
        set(&sh.in_lat, lat as f32);
        let gain = f(&sh.mic_gain);
        let pk = peak(&buf) * gain; if pk > f(&sh.peak) { set(&sh.peak, pk); }
        let captured = epoch_ms() - lat;          // when this chunk's first frame hit the input
        let f0 = blocker.frames as f64;
        let rec = sh.rec.load(Relaxed);
        blocker.feed(&buf, chans, gain, |b| {
            let at = captured + (b.first_frame as f64 - f0) * 1000.0 / RATE as f64;
            if rec { let _ = sh.out_tx.send(Out::RecMic { at_ms: at, data: b.planes[0].clone() }); }
            // time-stamped like the browser's blocks: when the block was ready to send
            let _ = sh.out_tx.send(Out::Block { at_ms: at + lat, planes: b.planes });
        });
        if sh.direct_active.load(Relaxed) {
            let f0 = fast.frames as f64;
            fast.feed(&buf, chans, gain, |b| { let _ = sh.direct_tx.try_send((b.planes, captured + (b.first_frame as f64 - f0) * 1000.0 / RATE as f64 + lat)); });
        }
    }, err_fn, None).map_err(|e| e.to_string())
}

/// Start the output stream. Returns the stream and the device's label.
pub fn start_output(id: &str, sh: &Arc<Shared>) -> Result<(Stream, String), String> {
    let (d, asio) = find(id, false).ok_or("No speakers or audio output found.")?;
    match open_output(&d, asio, sh) {
        Err(e) if asio && id.is_empty() => { eprintln!("ASIO output unavailable ({e}), using the system default"); let (d, _) = system_default(false).ok_or(e)?; open_output(&d, false, sh) }
        r => r,
    }
}
fn open_output(d: &Device, asio: bool, sh: &Arc<Shared>) -> Result<(Stream, String), String> {
    let (mut cfg, fmt) = pick(d, false)?;
    let build = |cfg: &StreamConfig| match fmt {
        SampleFormat::F32 => output::<f32>(d, cfg, sh.clone()),
        SampleFormat::F64 => output::<f64>(d, cfg, sh.clone()),
        SampleFormat::I32 => output::<i32>(d, cfg, sh.clone()),
        SampleFormat::I24 => output::<cpal::I24>(d, cfg, sh.clone()),
        SampleFormat::I16 => output::<i16>(d, cfg, sh.clone()),
        SampleFormat::U16 => output::<u16>(d, cfg, sh.clone()),
        other => Err(format!("Unsupported sample format {other:?}")),
    };
    let s = build(&cfg).or_else(|_| { cfg.buffer_size = BufferSize::Default; build(&cfg) })?;
    s.play().map_err(|e| e.to_string())?;
    Ok((s, label(d, asio)))
}

fn output<T: SizedSample + FromSample<f32>>(d: &Device, cfg: &StreamConfig, sh: Arc<Shared>) -> Result<Stream, String> {
    let chans = cfg.channels as usize;
    let mut mixer = Mixer::new();
    mixer.set_limit(*sh.limit.lock().unwrap()); mixer.set_feel(*sh.feel.lock().unwrap());
    let (mut l, mut r) = (vec![0f32; 8192], vec![0f32; 8192]);
    let mut quanta = 0u32;
    // device isn't at 48 kHz: mix at 48 kHz, convert to the device's rate
    let mut rate_out = (cfg.sample_rate.0 != RATE).then(|| RateOut::new(cfg.sample_rate.0));
    d.build_output_stream(cfg, move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
        while let Ok(c) = sh.cmd_rx.try_recv() {
            match c {
                Cmd::Deliver(id, a, b) => mixer.deliver(&id, &a, b.as_deref()),
                Cmd::Gone(id) => mixer.forget(&id),
                Cmd::Limit(s) => mixer.set_limit(s),
                Cmd::Feel(fl) => mixer.set_feel(fl),
            }
        }
        let frames = data.len() / chans;
        if l.len() < frames { l.resize(frames, 0.0); r.resize(frames, 0.0); }
        let ts = info.timestamp();
        let lat = ts.playback.duration_since(&ts.callback).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
        set(&sh.out_lat, (lat + mixer.pending() as f64 * 1000.0 / RATE as f64) as f32);
        let heard = epoch_ms() + lat;              // when data[0] reaches your ears
        let rec = sh.rec.load(Relaxed);
        let on_q = |ql: &[f32], qr: &[f32], start: usize| {
            quanta += 1;
            if rec { let _ = sh.out_tx.send(Out::RecOut { at_ms: heard + start as f64 * 1000.0 / RATE as f64, data: ql.iter().zip(qr).map(|(a, b)| (a + b) / 2.0).collect() }); }
        };
        if let Some(ro) = rate_out.as_mut() {
            ro.render(&mut mixer, &mut l[..frames], &mut r[..frames], on_q);
        } else {
            mixer.render(&mut l[..frames], &mut r[..frames], on_q);
        }
        for i in 0..frames {
            let o = i * chans;
            data[o] = <T as FromSample<f32>>::from_sample_(l[i]);
            if chans > 1 { data[o + 1] = <T as FromSample<f32>>::from_sample_(r[i]); }
            for c in 2..chans { data[o + c] = <T as FromSample<f32>>::from_sample_(0.0f32); }
        }
        if quanta >= 188 { quanta = 0; if let Ok(mut s) = sh.stats.try_lock() { s.under = mixer.under; s.players = mixer.stats(); } }
    }, err_fn, None).map_err(|e| e.to_string())
}
