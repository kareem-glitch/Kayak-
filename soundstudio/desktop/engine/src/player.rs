//! One adaptive jitter buffer per remote player (port of Player in worklet.js).
//! A ring of samples read at a slightly variable rate (±0.5 %) that steers the
//! fill level toward a target; the target shrinks toward the lowest fill seen
//! (plus a margin) and jumps up after a dropout. Dropouts fade out instead of clicking.
use crate::FRAMES;

const RING: usize = 16_384;
const MAX_RATE_DEV: f64 = 0.005;
const WINDOW: u32 = 375;

/// How the buffer trades delay for smoothness (same values as FEELS in worklet.js).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Feel { pub margin: f64, pub min: f64, pub hold: u32, pub shrink: f64 }
pub const TIGHT: Feel = Feel { margin: 16.0, min: 256.0, hold: 8, shrink: 24.0 };
pub const BALANCED: Feel = Feel { margin: 48.0, min: 272.0, hold: 10, shrink: 16.0 };
pub const SMOOTH: Feel = Feel { margin: 128.0, min: 512.0, hold: 30, shrink: 8.0 };
pub fn feel_named(name: &str) -> Feel { match name { "tight" => TIGHT, "smooth" => SMOOTH, _ => BALANCED } }

pub struct Player {
    l: Vec<f32>, r: Vec<f32>,
    w: u64, rd: f64,
    pub target: f64, pub limit: f64, pub feel: Feel,
    playing: bool, low: f64, n: u32,
    fade: f32, last_l: f32, last_r: f32, gain: f32,
    pub under: u32, pub rate: f64, hold: u32,
    /// size of the packets arriving (the direct app-to-app path sends 64 frames)
    pkt: usize,
}

impl Player {
    pub fn new(limit: f64, feel: Feel) -> Self {
        Player { l: vec![0.0; RING], r: vec![0.0; RING], w: 0, rd: 0.0,
            target: feel.min.max(256.0), limit, feel, playing: false, low: f64::INFINITY, n: 0,
            fade: 0.0, last_l: 0.0, last_r: 0.0, gain: 1.0, under: 0, rate: 1.0, hold: 0, pkt: FRAMES }
    }
    pub fn fill(&self) -> f64 { self.w as f64 - self.rd }
    /// The smallest target: the feel's, less what smaller packets save (a late
    /// 64-frame packet costs half as much to cover as a 128-frame one).
    fn floor(&self) -> f64 { self.feel.min - FRAMES.saturating_sub(self.pkt) as f64 }
    /// Append one block: mono, or left + right.
    pub fn push(&mut self, left: &[f32], right: Option<&[f32]>) {
        let n = left.len(); self.pkt = n;
        if self.fill() + n as f64 > (RING - 1) as f64 { self.rd = (self.w + n as u64) as f64 - (RING - 1) as f64; }
        for i in 0..n {
            let k = (self.w as usize + i) & (RING - 1);
            self.l[k] = left[i]; self.r[k] = right.map_or(left[i], |r| r[i]);
        }
        self.w += n as u64;
    }
    /// Mix one block into out_l/out_r. Returns true if this player dropped out.
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32]) -> bool {
        let n = out_l.len();
        if !self.playing {
            if self.fill() >= self.target { self.playing = true; self.gain = 0.0; }
            else { self.conceal(out_l, out_r); return false; }
        }
        let f = self.fill();
        let err = (f - self.target) / self.target.max(128.0);
        self.rate = 1.0 + (err * 0.01).clamp(-MAX_RATE_DEV, MAX_RATE_DEV);
        if f < n as f64 * self.rate + 2.0 {
            self.under += 1; self.playing = false;
            self.target = self.limit.min(self.target + 128.0); self.hold = self.feel.hold;
            self.conceal(out_l, out_r); return true;
        }
        for i in 0..n {
            let p = self.rd; let i0 = p.floor(); let t = (p - i0) as f32;
            let a = (i0 as u64 as usize) & (RING - 1); let b = (a + 1) & (RING - 1);
            if self.gain < 1.0 { self.gain = (self.gain + 1.0 / 64.0).min(1.0); }
            out_l[i] += (self.l[a] + (self.l[b] - self.l[a]) * t) * self.gain;
            out_r[i] += (self.r[a] + (self.r[b] - self.r[a]) * t) * self.gain;
            self.rd += self.rate;
        }
        let k = ((self.rd.floor() as u64).wrapping_sub(1) as usize) & (RING - 1);
        self.last_l = self.l[k]; self.last_r = self.r[k]; self.fade = 1.0;
        let after = self.fill(); if after < self.low { self.low = after; }
        self.n += 1;
        if self.n >= WINDOW {
            let spare = self.low - self.feel.margin;
            if self.hold > 0 { self.hold -= 1; }
            else if spare > 8.0 { self.target = self.floor().max(self.target - spare.min(self.feel.shrink)); }
            else if self.target < self.floor() { self.target = self.floor(); }
            self.target = self.target.min(self.limit);
            self.low = f64::INFINITY; self.n = 0;
        }
        false
    }
    fn conceal(&mut self, out_l: &mut [f32], out_r: &mut [f32]) {
        for i in 0..out_l.len() {
            if self.fade <= 0.0005 { break; }
            self.fade *= 0.985; out_l[i] += self.last_l * self.fade; out_r[i] += self.last_r * self.fade;
        }
    }
    pub fn buffer_ms(&self) -> f64 { self.target / crate::RATE as f64 * 1000.0 }
}

#[allow(dead_code)]
const _ASSERT_BLOCK: () = assert!(FRAMES == 128);

#[cfg(test)]
mod tests {
    use super::*;
    // Same simulation as test/worklet.test.js: blocks of a 440 Hz tone arriving at arrive(i) render quanta.
    fn simulate(seconds: f64, arrive: impl Fn(usize) -> f64, feel: Feel) -> (u32, u32, f64) { simulate_n(seconds, arrive, feel, 128) }
    fn simulate_n(seconds: f64, arrive: impl Fn(usize) -> f64, feel: Feel, n: usize) -> (u32, u32, f64) {
        let mut p = Player::new(16.0 * 128.0, feel);
        let quanta = (seconds * 375.0) as usize; let (mut sent, mut drop, mut clicks) = (0usize, 0u32, 0u32);
        let (mut phase, mut prev) = (0f64, 0f32);
        for q in 0..quanta {
            while arrive(sent) <= q as f64 {
                let b: Vec<f32> = (0..n).map(|_| { phase += 2.0 * std::f64::consts::PI * 440.0 / 48000.0; (0.5 * phase.sin()) as f32 }).collect();
                p.push(&b, None); sent += 1;
            }
            let (mut l, mut r) = ([0f32; 128], [0f32; 128]);
            if p.render(&mut l, &mut r) { drop += 1; }
            for v in l { if (v - prev).abs() > 0.2 { clicks += 1; } prev = v; }
        }
        (drop, clicks, p.buffer_ms())
    }
    fn jitter(ms: f64, seed: u64) -> impl Fn(usize) -> f64 {
        let r: Vec<f64> = { let mut x = seed; (0..200_000).map(|_| { x = x * 16807 % 2147483647; x as f64 / 2147483647.0 }).collect() };
        move |i| i as f64 + r[i] * ms / 2.667
    }
    #[test] fn steady_network_shrinks_to_floor_without_glitches() {
        let (d, c, ms) = simulate(40.0, |i| i as f64, BALANCED);
        assert_eq!((d, c), (0, 0)); assert!(ms <= 6.0, "{ms}");
    }
    #[test] fn smaller_packets_let_the_buffer_go_lower() {
        // the direct path: 64-frame packets, two per render quantum, steady
        let (d, c, ms) = simulate_n(40.0, |i| i as f64 / 2.0, TIGHT, 64);
        assert_eq!((d, c), (0, 0)); assert!(ms <= 4.1, "{ms}");
        let (_, _, ms128) = simulate(40.0, |i| i as f64, TIGHT);
        assert!(ms128 > ms + 1.0, "128-frame packets keep the old floor ({ms128} vs {ms})");
    }
    #[test] fn jitter_is_absorbed() {
        let (d, _, ms) = simulate(30.0, jitter(5.0, 1), BALANCED);
        assert!(d <= 3, "{d}"); assert!((4.0..=12.0).contains(&ms), "{ms}");
    }
    #[test] fn drift_is_absorbed() {
        for ppm in [100.0, -100.0] { let (d, _, _) = simulate(60.0, move |i| i as f64 * (1.0 + ppm / 1e6), BALANCED); assert_eq!(d, 0, "{ppm}"); }
    }
    #[test] fn tight_keeps_less_than_smooth() {
        let (_, _, t) = simulate(40.0, jitter(6.0, 7), TIGHT);
        let (_, c, s) = simulate(40.0, jitter(6.0, 7), SMOOTH);
        assert!(t < s, "{t} {s}"); assert_eq!(c, 0);
    }
}
