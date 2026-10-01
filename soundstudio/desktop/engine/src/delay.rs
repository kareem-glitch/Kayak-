//! Scheduled playback (port of DelayPlayer in worklet.js): in BARS (and far-apart
//! mode) each block carries the moment it must be heard, so the soloist lands on
//! this band's beat to the sample, instead of whenever it happens to arrive.
//! Blocks are written back to back on an absolute frame timeline; small clock
//! drift is absorbed one sample at a time; a block that's already late is played
//! a moment late rather than dropped (gaps sound robotic).

const DRING: usize = 1 << 18;   // ~5.4 s at 48 kHz: room for a bar at 45 bpm

pub struct DelayPlayer { l: Vec<f32>, r: Vec<f32>, e: Option<i64>, drift: f64, pub late: u32 }

impl Default for DelayPlayer { fn default() -> Self { Self::new() } }

impl DelayPlayer {
    pub fn new() -> Self { DelayPlayer { l: vec![0.0; DRING], r: vec![0.0; DRING], e: None, drift: 0.0, late: 0 } }
    /// One block that must sound at absolute frame `at`; `now` is the next frame to be rendered.
    pub fn push(&mut self, left: &[f32], right: Option<&[f32]>, at: i64, now: i64) {
        let n = left.len() as i64;
        let mut e = match self.e {
            Some(e) if e - at > 256 && at >= now => { self.drift = 0.0; at }   // more than 5 ms behind schedule: jump back on time (timing over smoothness)
            Some(e) if (at - e).abs() <= 1200 && e >= now => {
                self.drift = self.drift * 0.98 + (at - e) as f64 * 0.02;
                if self.drift > 48.0 { let k = (e as usize) & (DRING - 1); self.l[k] = left[0]; self.r[k] = right.map_or(left[0], |r| r[0]); self.drift -= 1.0; e + 1 }   // falling behind: repeat a sample
                else if self.drift < -48.0 { self.drift += 1.0; e - 1 }                                                                        // ahead: overwrite one
                else { e }
            }
            _ => { self.drift = 0.0; at }
        };
        if e + n <= now { self.late += 1; e = now + n; }                                   // late: play it a moment late
        else if e - now > (DRING as i64) - 2 * n { self.late += 1; self.e = Some(e + n); return; }   // too far ahead to hold
        for i in 0..n as usize {
            let k = ((e as usize) + i) & (DRING - 1);
            self.l[k] = left[i]; self.r[k] = right.map_or(left[i], |r| r[i]);
        }
        self.e = Some(e + n);
    }
    /// Mix the frames starting at absolute frame `frame` into out (and clear them).
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32], frame: i64) {
        for i in 0..out_l.len() {
            let k = ((frame + i as i64) as usize) & (DRING - 1);
            out_l[i] += self.l[k]; out_r[i] += self.r[k]; self.l[k] = 0.0; self.r[k] = 0.0;
        }
    }
}

/// Where the output is on the absolute (wall-clock) frame timeline: frames handed
/// to the device so far, plus a slowly smoothed offset from when they're heard,
/// so callback-to-callback timing noise doesn't make playback skip or repeat.
#[derive(Default)]
pub struct FrameClock { frames: u64, off: Option<f64> }
impl FrameClock {
    /// Called once per output callback: `heard_ms` is when its first frame reaches your ears.
    pub fn observe(&mut self, heard_ms: f64) {
        if !heard_ms.is_finite() { return; }
        let obs = heard_ms * 48.0 - self.frames as f64;
        self.off = Some(match self.off { Some(o) if (obs - o).abs() < 960.0 => o + (obs - o) * 0.002, _ => obs });
    }
    pub fn advance(&mut self, n: usize) { self.frames += n as u64; }
    /// The absolute frame of output index `i` in the current callback (None until observed).
    pub fn at(&self, i: usize) -> Option<i64> { self.off.map(|o| (self.frames as f64 + i as f64 + o).round() as i64) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn plays_each_block_at_its_frame() {
        let mut d = DelayPlayer::new();
        d.push(&[1.0; 64], None, 1000, 0); d.push(&[2.0; 64], None, 1064, 0);
        let (mut l, mut r) = (vec![0.0; 256], vec![0.0; 256]);
        d.render(&mut l, &mut r, 900);
        assert_eq!(l[99], 0.0); assert_eq!(l[100], 1.0); assert_eq!(l[164], 2.0); assert_eq!(l[228], 0.0);
        assert_eq!(d.late, 0);
    }
    #[test] fn late_blocks_play_a_moment_late() {
        let mut d = DelayPlayer::new();
        d.push(&[1.0; 64], None, 100, 500);
        let (mut l, mut r) = (vec![0.0; 128], vec![0.0; 128]);
        d.render(&mut l, &mut r, 500);
        assert_eq!(d.late, 1); assert_eq!(l[64], 1.0, "starts one block after now");
    }
    #[test] fn the_clock_smooths_callback_jitter() {
        let mut c = FrameClock::default();
        let mut prev: Option<i64> = None;
        for k in 0..400 {
            let jitter = if k % 2 == 0 { 0.4 } else { -0.4 };   // ±0.4 ms callback noise
            c.observe(10_000.0 + k as f64 * 128.0 / 48.0 + jitter);
            let f = c.at(0).unwrap();
            if let Some(p) = prev { assert!((f - p - 128).abs() <= 1, "step {k}: {}", f - p); }   // never skips more than a sample
            prev = Some(f); c.advance(128);
        }
    }
}
