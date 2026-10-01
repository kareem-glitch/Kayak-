//! Everything the output callback needs: the players' buffers, mixing to stereo
//! in 128-frame quanta for any device buffer size, dropout counts and stats.
use crate::delay::{DelayPlayer, FrameClock};
use crate::player::{Feel, Player, TIGHT};
use crate::FRAMES;
use std::collections::HashMap;

pub struct Mixer {
    players: HashMap<String, Player>,
    /// BARS / far apart: blocks scheduled to sound at an exact moment (delay.rs)
    delayed: HashMap<String, DelayPlayer>, clock: FrameClock, quantum_at: Option<i64>,
    pub limit: f64, pub feel: Feel, pub under: u32,
    carry_l: [f32; FRAMES], carry_r: [f32; FRAMES], carry_pos: usize,
}

#[derive(Clone, Debug, Default)]
pub struct PlayerStats { pub id: String, pub buffer_ms: f64, pub rate: f64, pub under: u32, pub late: u32 }

impl Mixer {
    pub fn new() -> Self {
        Mixer { players: HashMap::new(), delayed: HashMap::new(), clock: FrameClock::default(), quantum_at: None, limit: 8.0 * FRAMES as f64, feel: TIGHT, under: 0,
            carry_l: [0.0; FRAMES], carry_r: [0.0; FRAMES], carry_pos: FRAMES }
    }
    pub fn deliver(&mut self, id: &str, left: &[f32], right: Option<&[f32]>) {
        let (limit, feel) = (self.limit, self.feel);
        self.players.entry(id.to_string()).or_insert_with(|| Player::new(limit, feel)).push(left, right);
    }
    /// A block that must be heard at `at_ms` (wall-clock ms).
    pub fn deliver_at(&mut self, id: &str, left: &[f32], right: Option<&[f32]>, at_ms: f64) {
        let now = self.clock.at(0).unwrap_or(i64::MIN / 2);
        self.delayed.entry(id.to_string()).or_default().push(left, right, (at_ms * 48.0).round() as i64, now);
    }
    pub fn forget(&mut self, id: &str) { self.players.remove(id); self.delayed.remove(id); }
    pub fn set_limit(&mut self, samples: f64) {
        self.limit = samples;
        for p in self.players.values_mut() { p.limit = samples; p.target = p.target.min(samples); }
    }
    pub fn set_feel(&mut self, feel: Feel) { self.feel = feel; for p in self.players.values_mut() { p.feel = feel; } }
    fn quantum(&mut self) {
        self.carry_l = [0.0; FRAMES]; self.carry_r = [0.0; FRAMES];
        for p in self.players.values_mut() { if p.render(&mut self.carry_l, &mut self.carry_r) { self.under += 1; } }
        if let Some(f) = self.quantum_at { for d in self.delayed.values_mut() { d.render(&mut self.carry_l, &mut self.carry_r, f); } }
        self.carry_pos = 0;
    }
    /// Fill `n` frames of stereo output (any n), calling `on_quantum` with each
    /// new 128-frame quantum and the index in `out` where it starts (for recording).
    pub fn render(&mut self, out_l: &mut [f32], out_r: &mut [f32], on_quantum: impl FnMut(&[f32], &[f32], usize)) {
        self.render_at(f64::NAN, out_l, out_r, on_quantum)
    }
    /// As render, knowing when out[0] will be heard (wall-clock ms), for scheduled blocks.
    pub fn render_at(&mut self, heard_ms: f64, out_l: &mut [f32], out_r: &mut [f32], mut on_quantum: impl FnMut(&[f32], &[f32], usize)) {
        self.clock.observe(heard_ms);
        let mut i = 0;
        while i < out_l.len() {
            // a new quantum's first frame is heard after what's still waiting in the carry
            if self.carry_pos == FRAMES { self.quantum_at = self.clock.at(i); self.quantum(); on_quantum(&self.carry_l, &self.carry_r, i); }
            let take = (FRAMES - self.carry_pos).min(out_l.len() - i);
            out_l[i..i + take].copy_from_slice(&self.carry_l[self.carry_pos..self.carry_pos + take]);
            out_r[i..i + take].copy_from_slice(&self.carry_r[self.carry_pos..self.carry_pos + take]);
            self.carry_pos += take; i += take;
        }
        self.clock.advance(out_l.len());
    }
    /// Frames already mixed but not yet handed to the device (adds to output delay).
    pub fn pending(&self) -> usize { FRAMES - self.carry_pos }
    pub fn stats(&self) -> Vec<PlayerStats> {
        let mut v: Vec<PlayerStats> = self.players.iter().map(|(id, p)| PlayerStats { id: id.clone(), buffer_ms: p.buffer_ms(), rate: p.rate, under: p.under, late: self.delayed.get(id).map_or(0, |d| d.late) }).collect();
        for (id, d) in &self.delayed { if !self.players.contains_key(id) { v.push(PlayerStats { id: id.clone(), buffer_ms: 0.0, rate: 1.0, under: 0, late: d.late }); } }
        v
    }
}

impl Default for Mixer { fn default() -> Self { Self::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn odd_device_buffer_sizes_get_continuous_audio() {
        let mut m = Mixer::new();
        let block: Vec<f32> = (0..128).map(|i| i as f32 / 128.0).collect();
        for _ in 0..8 { m.deliver("a", &block, None); }
        let mut got = vec![];
        for n in [100usize, 37, 256, 64, 99] {
            let (mut l, mut r) = (vec![0f32; n], vec![0f32; n]);
            m.render(&mut l, &mut r, |_, _, _| {}); got.extend(l);
        }
        assert_eq!(got.len(), 556);
        assert!(got.iter().any(|v| *v > 0.5), "audio came through");
    }
    #[test] fn scheduled_blocks_sound_at_their_moment() {
        let mut m = Mixer::new();
        let heard = 1_000_000.0;   // ms: when the first frame of the first callback is heard
        let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
        m.render_at(heard, &mut l, &mut r, |_, _, _| {});
        m.deliver_at("a", &[1.0; 128], None, heard + 10.0);   // 10 ms in: frame 480
        let mut got = vec![];
        for k in 1..4 { let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]); m.render_at(heard + k as f64 * 256.0 / 48.0, &mut l, &mut r, |_, _, _| {}); got.extend(l); }
        let first = got.iter().position(|v| *v > 0.5).unwrap() + 256;
        assert!((first as i64 - 480).abs() <= 1, "heard at frame {first}, 10 ms in");
    }
    #[test] fn forgetting_a_player_silences_it() {
        let mut m = Mixer::new(); let b = vec![0.5f32; 128];
        for _ in 0..8 { m.deliver("a", &b, None); }
        m.forget("a");
        let (mut l, mut r) = (vec![0f32; 128], vec![0f32; 128]); m.render(&mut l, &mut r, |_, _, _| {});
        assert!(l.iter().all(|v| *v == 0.0));
    }
}
