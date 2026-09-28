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
use ssengine::RATE;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Smallest device buffer we ask for, in frames (1.3 ms at 48 kHz).
const WANT_BUFFER: u32 = 64;

pub enum Cmd { Deliver(String, Vec<f32>, Option<Vec<f32>>), Gone(String), Limit(f64), Feel(Feel) }
pub enum Out {
    Block { at_ms: f64, planes: Vec<Vec<f32>> },
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
}
fn f(a: &AtomicU32) -> f32 { f32::from_bits(a.load(Relaxed)) }
fn set(a: &AtomicU32, v: f32) { a.store(v.to_bits(), Relaxed) }
pub fn epoch_ms() -> f64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0) }

impl Shared {
    pub fn new(out_tx: Sender<Out>) -> Arc<Self> {
        let (cmd_tx, cmd_rx) = crossbeam_channel::unbounded();
        Arc::new(Shared { cmd_tx, cmd_rx, out_tx, mic_gain: AtomicU32::new(1f32.to_bits()), peak: AtomicU32::new(0),
            in_lat: AtomicU32::new(0), out_lat: AtomicU32::new(0), rec: AtomicBool::new(false), plugin_live: AtomicBool::new(false), channel: AtomicU32::new(0),
            stats: Mutex::new(Stats::default()), limit: Mutex::new(8.0 * 128.0), feel: Mutex::new(TIGHT) })
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

pub fn host() -> cpal::Host { cpal::default_host() }
fn name(d: &Device) -> String { d.name().unwrap_or_else(|_| "Unknown device".into()) }

/// (name, channels) of every input and output device.
pub fn devices() -> (Vec<(String, u16)>, Vec<(String, u16)>) {
    let h = host();
    let list = |it: Option<Box<dyn Iterator<Item = Device>>>, input: bool| -> Vec<(String, u16)> {
        it.map(|i| i.map(|d| { let ch = pick(&d, input).map(|(c, _)| c.channels).unwrap_or(0); (name(&d), ch) }).filter(|(_, ch)| *ch > 0).collect()).unwrap_or_default()
    };
    (list(h.input_devices().ok().map(|i| Box::new(i) as Box<dyn Iterator<Item = Device>>), true),
     list(h.output_devices().ok().map(|i| Box::new(i) as Box<dyn Iterator<Item = Device>>), false))
}

/// The named device, or the system default if the name is empty or not found.
pub fn find(id: &str, input: bool) -> Option<Device> {
    let h = host();
    if !id.is_empty() {
        let found = if input { h.input_devices().ok().and_then(|mut i| i.find(|d| name(d) == id)) } else { h.output_devices().ok().and_then(|mut i| i.find(|d| name(d) == id)) };
        if found.is_some() { return found; }
    }
    if input { h.default_input_device() } else { h.default_output_device() }
}

/// A 48 kHz config with up to 2 channels (prefer 2), float samples if offered,
/// and the smallest buffer the device allows (down to WANT_BUFFER).
fn pick(d: &Device, input: bool) -> Result<(StreamConfig, SampleFormat), String> {
    let ranges: Vec<_> = if input { d.supported_input_configs().map_err(|e| e.to_string())?.collect() } else { d.supported_output_configs().map_err(|e| e.to_string())?.collect() };
    let ok = ranges.into_iter().filter(|r| r.min_sample_rate().0 <= RATE && r.max_sample_rate().0 >= RATE);
    let best = ok.max_by_key(|r| {
        let ch = r.channels();
        let ch_score = if ch == 2 { 3 } else if ch == 1 { 2 } else { 1 };   // 2 best, then mono, then multichannel
        let fmt_score = match r.sample_format() { SampleFormat::F32 => 3, SampleFormat::I32 => 2, SampleFormat::I16 => 1, _ => 0 };
        (ch_score, fmt_score)
    }).ok_or_else(|| format!("{} doesn't run at 48 kHz. Set it to 48 kHz in your sound settings.", name(d)))?;
    let buffer_size = match best.buffer_size() { SupportedBufferSize::Range { min, max } => BufferSize::Fixed(WANT_BUFFER.clamp(*min, *max)), SupportedBufferSize::Unknown => BufferSize::Default };
    Ok((StreamConfig { channels: best.channels(), sample_rate: SampleRate(RATE), buffer_size }, best.sample_format()))
}

fn err_fn(e: cpal::StreamError) { eprintln!("audio stream error: {e}") }

/// Start the input stream. Returns the stream, the device's name and channel count.
pub fn start_input(id: &str, channel: InputChannel, sh: &Arc<Shared>) -> Result<(Stream, String, u16), String> {
    let d = find(id, true).ok_or("No microphone or audio input found.")?;
    let (mut cfg, fmt) = pick(&d, true)?;
    let build = |cfg: &StreamConfig| match fmt {
        SampleFormat::F32 => input::<f32>(&d, cfg, channel, sh.clone()),
        SampleFormat::I32 => input::<i32>(&d, cfg, channel, sh.clone()),
        SampleFormat::I16 => input::<i16>(&d, cfg, channel, sh.clone()),
        SampleFormat::U16 => input::<u16>(&d, cfg, channel, sh.clone()),
        other => Err(format!("Unsupported sample format {other:?}")),
    };
    let s = build(&cfg).or_else(|_| { cfg.buffer_size = BufferSize::Default; build(&cfg) })?;
    s.play().map_err(|e| e.to_string())?;
    Ok((s, name(&d), cfg.channels))
}

fn input<T: SizedSample>(d: &Device, cfg: &StreamConfig, channel: InputChannel, sh: Arc<Shared>) -> Result<Stream, String> where f32: FromSample<T> {
    let chans = cfg.channels as usize;
    let mut blocker = Blocker::new(channel);
    let mut buf: Vec<f32> = Vec::with_capacity(8192);
    d.build_input_stream(cfg, move |data: &[T], info: &cpal::InputCallbackInfo| {
        if sh.plugin_live.load(Relaxed) { return; }   // your DAW (through the plugin) is the input right now
        buf.clear(); buf.extend(data.iter().map(|s| <f32 as FromSample<T>>::from_sample_(*s)));
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
    }, err_fn, None).map_err(|e| e.to_string())
}

/// Start the output stream. Returns the stream and the device's name.
pub fn start_output(id: &str, sh: &Arc<Shared>) -> Result<(Stream, String), String> {
    let d = find(id, false).ok_or("No speakers or audio output found.")?;
    let (mut cfg, fmt) = pick(&d, false)?;
    let build = |cfg: &StreamConfig| match fmt {
        SampleFormat::F32 => output::<f32>(&d, cfg, sh.clone()),
        SampleFormat::I32 => output::<i32>(&d, cfg, sh.clone()),
        SampleFormat::I16 => output::<i16>(&d, cfg, sh.clone()),
        SampleFormat::U16 => output::<u16>(&d, cfg, sh.clone()),
        other => Err(format!("Unsupported sample format {other:?}")),
    };
    let s = build(&cfg).or_else(|_| { cfg.buffer_size = BufferSize::Default; build(&cfg) })?;
    s.play().map_err(|e| e.to_string())?;
    Ok((s, name(&d)))
}

fn output<T: SizedSample + FromSample<f32>>(d: &Device, cfg: &StreamConfig, sh: Arc<Shared>) -> Result<Stream, String> {
    let chans = cfg.channels as usize;
    let mut mixer = Mixer::new();
    mixer.set_limit(*sh.limit.lock().unwrap()); mixer.set_feel(*sh.feel.lock().unwrap());
    let (mut l, mut r) = (vec![0f32; 8192], vec![0f32; 8192]);
    let mut quanta = 0u32;
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
        mixer.render(&mut l[..frames], &mut r[..frames], |ql, qr, start| {
            quanta += 1;
            if rec { let _ = sh.out_tx.send(Out::RecOut { at_ms: heard + start as f64 * 1000.0 / RATE as f64, data: ql.iter().zip(qr).map(|(a, b)| (a + b) / 2.0).collect() }); }
        });
        for i in 0..frames {
            let o = i * chans;
            data[o] = <T as FromSample<f32>>::from_sample_(l[i]);
            if chans > 1 { data[o + 1] = <T as FromSample<f32>>::from_sample_(r[i]); }
            for c in 2..chans { data[o + c] = <T as FromSample<f32>>::from_sample_(0.0f32); }
        }
        if quanta >= 188 { quanta = 0; if let Ok(mut s) = sh.stats.try_lock() { s.under = mixer.under; s.players = mixer.stats(); } }
    }, err_fn, None).map_err(|e| e.to_string())
}
