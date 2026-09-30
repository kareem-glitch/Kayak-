//! Streaming rate conversion for devices that don't run at 48 kHz (many
//! Windows setups default to 44.1 kHz). Linear interpolation: one sample of
//! delay, no allocation once warmed up. Interleaved samples, any channel count.
pub struct Resampler {
    step: f64,        // input frames per output frame
    pos: f64,         // read position in `buf`, in frames
    buf: Vec<f32>,    // input not yet fully consumed (interleaved)
    chans: usize,
}

impl Resampler {
    pub fn new(from: u32, to: u32, chans: usize) -> Self {
        Resampler { step: from as f64 / to as f64, pos: 0.0, buf: Vec::with_capacity(8192), chans: chans.max(1) }
    }
    /// Add input frames (interleaved).
    pub fn push(&mut self, data: &[f32]) { self.buf.extend_from_slice(data); }
    /// Output frames that `pull` can produce right now.
    pub fn available(&self) -> usize {
        let n = self.buf.len() / self.chans;
        if n < 2 { return 0; }
        let last = (n - 1) as f64;   // interpolation needs the frame after
        if self.pos >= last { 0 } else { ((last - self.pos) / self.step).ceil() as usize }
    }
    /// Write up to out.len() / chans output frames (interleaved); returns how many.
    pub fn pull(&mut self, out: &mut [f32]) -> usize {
        let (c, n) = (self.chans, self.buf.len() / self.chans);
        let mut k = 0;
        while (k + 1) * c <= out.len() {
            let i0 = self.pos.floor() as usize;
            if i0 + 1 >= n { break; }
            let t = (self.pos - i0 as f64) as f32;
            for ch in 0..c {
                let (a, b) = (self.buf[i0 * c + ch], self.buf[(i0 + 1) * c + ch]);
                out[k * c + ch] = a + (b - a) * t;
            }
            self.pos += self.step; k += 1;
        }
        let used = (self.pos.floor() as usize).min(n.saturating_sub(1));
        if used > 0 { self.buf.drain(..used * c); self.pos -= used as f64; }
        k
    }
}

/// The mixer's 48 kHz output converted to a device's rate: fills `l`/`r` (device
/// frames), calling `on_quantum` like Mixer::render (start = 48 kHz frames rendered so far).
pub struct RateOut { rs: Resampler, inter: Vec<f32> }
impl RateOut {
    pub fn new(device_rate: u32) -> Self { RateOut { rs: Resampler::new(crate::RATE, device_rate, 2), inter: Vec::with_capacity(16384) } }
    pub fn render(&mut self, mixer: &mut crate::mixer::Mixer, l: &mut [f32], r: &mut [f32], mut on_quantum: impl FnMut(&[f32], &[f32], usize)) {
        let frames = l.len();
        let (mut ql, mut qr) = ([0f32; crate::FRAMES], [0f32; crate::FRAMES]);
        let mut made = 0usize;
        while self.rs.available() < frames {
            mixer.render(&mut ql, &mut qr, |a, b, _| on_quantum(a, b, made));
            self.inter.clear();
            for i in 0..crate::FRAMES { self.inter.push(ql[i]); self.inter.push(qr[i]); }
            self.rs.push(&self.inter); made += crate::FRAMES;
        }
        self.inter.resize(frames * 2, 0.0);
        self.rs.pull(&mut self.inter[..frames * 2]);
        for i in 0..frames { l[i] = self.inter[2 * i]; r[i] = self.inter[2 * i + 1]; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sine(rate: f64, n: usize) -> Vec<f32> { (0..n).map(|i| (2.0 * std::f64::consts::PI * 440.0 * i as f64 / rate).sin() as f32).collect() }

    #[test]
    fn converts_44k1_to_48k_in_small_chunks() {
        let input = sine(44_100.0, 44_100);
        let mut r = Resampler::new(44_100, 48_000, 1);
        let (mut out, mut tmp) = (vec![], vec![0f32; 64]);
        for chunk in input.chunks(97) { r.push(chunk); loop { let k = r.pull(&mut tmp); if k == 0 { break; } out.extend_from_slice(&tmp[..k]); } }
        assert!((out.len() as i64 - 48_000).abs() <= 2, "one second in, one second out ({})", out.len());
        let want = sine(48_000.0, out.len());
        let err = out.iter().zip(&want).skip(10).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(err < 0.01, "same 440 Hz tone (max error {err})");
    }

    #[test]
    fn stereo_channels_stay_apart_and_available_matches() {
        let mut r = Resampler::new(48_000, 44_100, 2);
        let data: Vec<f32> = (0..480).flat_map(|_| [0.5f32, -0.25]).collect();
        r.push(&data);
        let avail = r.available();
        let mut out = vec![0f32; 2 * 1000];
        let k = r.pull(&mut out);
        assert_eq!(k, avail);
        assert!(out[..2 * k].chunks(2).all(|f| (f[0] - 0.5).abs() < 1e-6 && (f[1] + 0.25).abs() < 1e-6));
    }

    #[test]
    fn mixer_output_at_44k1_keeps_the_tone_and_timing() {
        use crate::mixer::Mixer;
        let mut m = Mixer::new(); m.set_limit(48_000.0);
        let tone = sine(48_000.0, 48_000);
        let mut blocks = tone.chunks(128);
        let mut out = RateOut::new(44_100);
        let (mut l, mut r, mut all) = (vec![0f32; 441], vec![0f32; 441], vec![]);
        for k in 0..50 {   // 0.5 s in 10 ms callbacks, the audio arriving as it's played
            for _ in 0..4 { if let Some(b) = blocks.next() { m.deliver("a", b, None); } }   // ~10.7 ms of audio per 10 ms
            if k == 0 { for _ in 0..2 { if let Some(b) = blocks.next() { m.deliver("a", b, None); } } }
            out.render(&mut m, &mut l, &mut r, |_, _, _| {}); all.extend_from_slice(&l);
        }
        // count upward zero crossings once playing: 440 Hz for the time that was playing
        let start = all.iter().position(|v| v.abs() > 0.5).unwrap();
        let s = &all[start..]; let ups = s.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f64;
        let hz = ups / (s.len() as f64 / 44_100.0);
        assert!((hz - 440.0).abs() < 8.0, "still 440 Hz at the device's rate ({hz:.1})");
        assert!(s.windows(2).all(|w| (w[1] - w[0]).abs() < 0.1), "no clicks between callbacks");
    }

    #[test]
    fn same_rate_passes_through() {
        let mut r = Resampler::new(48_000, 48_000, 1);
        r.push(&[1.0, 2.0, 3.0, 4.0]);
        let mut out = [0f32; 8];
        let k = r.pull(&mut out);
        assert_eq!(&out[..k], &[1.0, 2.0, 3.0]);   // the last frame waits for the next one
    }
}
