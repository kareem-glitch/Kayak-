//! Input side: turns a device's interleaved samples (any chunk size, any channel
//! count) into 128-frame blocks of the chosen channel(s), as the browser sends them.
use crate::FRAMES;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InputChannel { One, Two, Mix, Stereo }
impl InputChannel {
    pub fn parse(s: &str) -> Self { match s { "2" => Self::Two, "mix" => Self::Mix, "stereo" => Self::Stereo, _ => Self::One } }
}

pub struct Blocker { l: Vec<f32>, r: Vec<f32>, pub channel: InputChannel, first_frame: u64, pub frames: u64, size: usize }

/// A finished block: planes (1 or 2) and the index of its first frame since start.
pub struct Block { pub planes: Vec<Vec<f32>>, pub first_frame: u64 }

impl Blocker {
    pub fn new(channel: InputChannel) -> Self { Self::with_size(channel, FRAMES) }
    /// Blocks of `size` frames (the direct app-to-app path uses 64: 1.3 ms).
    pub fn with_size(channel: InputChannel, size: usize) -> Self {
        Blocker { l: Vec::with_capacity(size), r: Vec::with_capacity(size), channel, first_frame: 0, frames: 0, size }
    }
    /// Feed interleaved samples with `chans` channels; `emit` gets each full block.
    pub fn feed(&mut self, data: &[f32], chans: usize, gain: f32, mut emit: impl FnMut(Block)) {
        let chans = chans.max(1);
        for frame in data.chunks_exact(chans) {
            if self.l.is_empty() { self.first_frame = self.frames; }
            let a = frame[0]; let b = if chans > 1 { frame[1] } else { a };
            match self.channel {
                InputChannel::One => self.l.push(a * gain),
                InputChannel::Two => self.l.push(b * gain),
                InputChannel::Mix => self.l.push((a + b) * 0.5 * gain),
                InputChannel::Stereo => { self.l.push(a * gain); self.r.push(b * gain); }
            }
            self.frames += 1;
            if self.l.len() == self.size {
                let mut planes = vec![std::mem::replace(&mut self.l, Vec::with_capacity(self.size))];
                if self.channel == InputChannel::Stereo && chans > 1 { planes.push(std::mem::replace(&mut self.r, Vec::with_capacity(self.size))); }
                self.r.clear();
                emit(Block { planes, first_frame: self.first_frame });
            }
        }
    }
}

/// Loudest absolute sample.
pub fn peak(data: &[f32]) -> f32 { data.iter().fold(0.0f32, |m, v| m.max(v.abs())) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn blocks_of_128_from_any_chunks_and_channel_choice() {
        let mut b = Blocker::new(InputChannel::Two); let mut out = vec![];
        let data: Vec<f32> = (0..300).flat_map(|i| [i as f32, -(i as f32)]).collect();
        b.feed(&data[..200], 2, 1.0, |x| out.push(x)); b.feed(&data[200..], 2, 1.0, |x| out.push(x));
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].first_frame, 128); assert_eq!(out[1].planes.len(), 1); assert_eq!(out[1].planes[0][0], -128.0);
    }
    #[test] fn smaller_blocks_for_the_direct_path() {
        let mut out = vec![];
        Blocker::with_size(InputChannel::One, 64).feed(&vec![0.5; 200], 1, 1.0, |x| out.push((x.planes[0].len(), x.first_frame)));
        assert_eq!(out, vec![(64, 0), (64, 64), (64, 128)]);
    }
    #[test] fn stereo_gives_two_planes_mono_device_gives_one() {
        let mut out = vec![];
        Blocker::new(InputChannel::Stereo).feed(&vec![0.1; 256], 2, 1.0, |x| out.push(x.planes.len()));
        Blocker::new(InputChannel::Stereo).feed(&vec![0.1; 128], 1, 1.0, |x| out.push(x.planes.len()));
        assert_eq!(out, vec![2, 1]);
    }
}
