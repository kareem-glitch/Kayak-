//! The link from the air.band plugin (inside your DAW) to the app, on your own
//! computer only (UDP on 127.0.0.1). The plugin sends your track's audio,
//! already at 48 kHz, in packets of up to 256 frames; the app answers now and
//! then so the plugin can show it's connected.
//!
//! Plugin -> app (little-endian):
//!   [0..4] "AIRB"  [4] version (1)  [5] channels (1 or 2)  [6..8] u16 frames
//!   [8..12] u32 sequence  [12..16] f32 the DAW's input delay estimate (ms)
//!   then each channel's samples as f32, one channel after the other
//! App -> plugin: "AIRA" [4] version (1)
//! plugin/Source/Link.h writes the same format.

pub const PORT: u16 = 47810;
pub const VERSION: u8 = 1;
pub const MAX_FRAMES: usize = 256;
pub const ACK: [u8; 5] = [b'A', b'I', b'R', b'A', VERSION];
const HEADER: usize = 16;

#[derive(Debug, Clone, PartialEq)]
pub struct Packet { pub seq: u32, pub latency_ms: f32, pub planes: Vec<Vec<f32>> }

pub fn decode(b: &[u8]) -> Option<Packet> {
    if b.len() < HEADER || &b[0..4] != b"AIRB" || b[4] != VERSION { return None; }
    let (chans, frames) = (b[5] as usize, u16::from_le_bytes([b[6], b[7]]) as usize);
    if !(1..=2).contains(&chans) || frames == 0 || frames > MAX_FRAMES || b.len() != HEADER + chans * frames * 4 { return None; }
    let seq = u32::from_le_bytes([b[8], b[9], b[10], b[11]]);
    let latency_ms = f32::from_le_bytes([b[12], b[13], b[14], b[15]]);
    let planes = (0..chans).map(|c| {
        let s = HEADER + c * frames * 4;
        b[s..s + frames * 4].chunks_exact(4).map(|x| f32::from_le_bytes([x[0], x[1], x[2], x[3]])).collect()
    }).collect();
    Some(Packet { seq, latency_ms, planes })
}

/// What the plugin sends (used by tests and tools; the plugin itself is C++).
pub fn encode(p: &Packet) -> Vec<u8> {
    let frames = p.planes[0].len();
    let mut b = Vec::with_capacity(HEADER + p.planes.len() * frames * 4);
    b.extend_from_slice(b"AIRB"); b.push(VERSION); b.push(p.planes.len() as u8);
    b.extend_from_slice(&(frames as u16).to_le_bytes()); b.extend_from_slice(&p.seq.to_le_bytes()); b.extend_from_slice(&p.latency_ms.to_le_bytes());
    for pl in &p.planes { for x in pl { b.extend_from_slice(&x.to_le_bytes()); } }
    b
}

/// Interleave planes (what the input path's Blocker takes).
pub fn interleave(planes: &[Vec<f32>]) -> Vec<f32> {
    let n = planes[0].len();
    (0..n).flat_map(|i| planes.iter().map(move |p| p[i])).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn round_trip_stereo_and_mono() {
        for chans in [1usize, 2] {
            let p = Packet { seq: 7, latency_ms: 5.5, planes: (0..chans).map(|c| (0..200).map(|i| i as f32 * 0.001 * (c as f32 + 1.0)).collect()).collect() };
            assert_eq!(decode(&encode(&p)), Some(p));
        }
    }
    #[test] fn rejects_junk() {
        let good = encode(&Packet { seq: 1, latency_ms: 0.0, planes: vec![vec![0.5; 128]] });
        assert!(decode(&good).is_some());
        assert!(decode(&good[..good.len() - 1]).is_none(), "truncated");
        let mut bad = good.clone(); bad[0] = b'X'; assert!(decode(&bad).is_none(), "wrong magic");
        let mut bad = good.clone(); bad[4] = 9; assert!(decode(&bad).is_none(), "unknown version");
        let mut bad = good.clone(); bad[5] = 3; assert!(decode(&bad).is_none(), "3 channels");
        assert!(decode(b"hello").is_none());
    }
    #[test] fn interleaves_for_the_blocker() {
        assert_eq!(interleave(&[vec![1.0, 2.0], vec![-1.0, -2.0]]), vec![1.0, -1.0, 2.0, -2.0]);
    }
}
