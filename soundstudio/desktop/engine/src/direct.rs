//! Direct audio between two desktop apps (UDP, app to app), the fast lane next
//! to the browser's WebRTC path: no page, no web view, no SCTP in the way, so
//! less delay and steadier timing. This module is the wire format, the public
//! address lookup (STUN) and loss concealment; desktop/src-tauri/src/direct.rs
//! runs the socket.
//!
//! Packet (little-endian):
//!   [0..4] "AIRP"  [4] version (1)  [5] kind: 1 probe, 2 probe answer, 3 audio
//!   [6..8] u16 frames  [8..16] u64 the sender's token (who it's from)
//!   [16..20] u32 sequence  [20..28] f64 when played (sender's page clock, ms)
//!   [28] channels  [29] bits (16 or 32)  [30..32] reserved
//!   then each channel's samples (i16 or f32), one channel after the other
//! Probes and answers are just the header. A token is random per app session and
//! exchanged over the room's encrypted control channel, so strangers can't inject.

pub const VERSION: u8 = 1;
pub const HEADER: usize = 32;
pub const PROBE: u8 = 1;
pub const ANSWER: u8 = 2;
pub const AUDIO: u8 = 3;
pub const MAX_FRAMES: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub struct Packet { pub kind: u8, pub token: u64, pub seq: u32, pub time_ms: f64, pub bits: u8, pub planes: Vec<Vec<f32>> }

pub fn encode(p: &Packet) -> Vec<u8> {
    let frames = p.planes.first().map_or(0, |x| x.len());
    let bytes = if p.bits == 32 { 4 } else { 2 };
    let mut b = Vec::with_capacity(HEADER + p.planes.len() * frames * bytes);
    b.extend_from_slice(b"AIRP"); b.push(VERSION); b.push(p.kind);
    b.extend_from_slice(&(frames as u16).to_le_bytes()); b.extend_from_slice(&p.token.to_le_bytes());
    b.extend_from_slice(&p.seq.to_le_bytes()); b.extend_from_slice(&p.time_ms.to_le_bytes());
    b.push(p.planes.len() as u8); b.push(if p.bits == 32 { 32 } else { 16 }); b.extend_from_slice(&[0, 0]);
    for pl in &p.planes {
        for &x in pl {
            if p.bits == 32 { b.extend_from_slice(&x.to_le_bytes()); }
            else { b.extend_from_slice(&((x.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes()); }
        }
    }
    b
}

pub fn decode(b: &[u8]) -> Option<Packet> {
    if b.len() < HEADER || &b[0..4] != b"AIRP" || b[4] != VERSION { return None; }
    let kind = b[5];
    let frames = u16::from_le_bytes([b[6], b[7]]) as usize;
    let token = u64::from_le_bytes(b[8..16].try_into().ok()?);
    let seq = u32::from_le_bytes(b[16..20].try_into().ok()?);
    let time_ms = f64::from_le_bytes(b[20..28].try_into().ok()?);
    let (chans, bits) = (b[28] as usize, b[29]);
    if kind != AUDIO { return (kind == PROBE || kind == ANSWER).then(|| Packet { kind, token, seq, time_ms, bits, planes: vec![] }); }
    let bytes = match bits { 16 => 2, 32 => 4, _ => return None };
    if !(1..=2).contains(&chans) || frames == 0 || frames > MAX_FRAMES || b.len() != HEADER + chans * frames * bytes { return None; }
    let planes = (0..chans).map(|c| {
        let s = HEADER + c * frames * bytes;
        b[s..s + frames * bytes].chunks_exact(bytes).map(|x| if bytes == 4 { f32::from_le_bytes([x[0], x[1], x[2], x[3]]) } else { i16::from_le_bytes([x[0], x[1]]) as f32 / 32767.0 }).collect()
    }).collect();
    Some(Packet { kind, token, seq, time_ms, bits, planes })
}

/// Sequence numbers wrap: how far `b` is after `a` (negative: before).
pub fn seq_delta(a: u32, b: u32) -> i64 { b.wrapping_sub(a) as i32 as i64 }

/// Fill `k` lost blocks with the last one, fading (the same as room.js does for
/// the browser path), so the buffer keeps its timing instead of running dry.
pub fn conceal(last: &[Vec<f32>], k: usize) -> Vec<Vec<Vec<f32>>> {
    (0..k).map(|j| {
        let (a, b) = (0.6f32.powi(j as i32), 0.6f32.powi(j as i32 + 1));
        last.iter().map(|pl| { let n = pl.len() as f32; pl.iter().enumerate().map(|(i, x)| x * (a + (b - a) * i as f32 / n)).collect() }).collect()
    }).collect()
}

// ---- STUN (RFC 5389): ask a public server what address our packets come from ----

/// A binding request with this transaction id.
pub fn stun_request(txid: [u8; 12]) -> [u8; 20] {
    let mut b = [0u8; 20];
    b[0..2].copy_from_slice(&0x0001u16.to_be_bytes());
    b[4..8].copy_from_slice(&0x2112A442u32.to_be_bytes());
    b[8..20].copy_from_slice(&txid);
    b
}
/// Is this a STUN message (vs one of our packets)?
pub fn is_stun(b: &[u8]) -> bool { b.len() >= 20 && b[4..8] == 0x2112A442u32.to_be_bytes() }
/// The public IPv4 address and port from a binding success response.
pub fn stun_mapped(b: &[u8], txid: [u8; 12]) -> Option<std::net::SocketAddrV4> {
    if !is_stun(b) || u16::from_be_bytes([b[0], b[1]]) != 0x0101 || b[8..20] != txid { return None; }
    let len = u16::from_be_bytes([b[2], b[3]]) as usize;
    let mut o = 20; let end = (20 + len).min(b.len());
    let mut plain = None;
    while o + 4 <= end {
        let (t, l) = (u16::from_be_bytes([b[o], b[o + 1]]), u16::from_be_bytes([b[o + 2], b[o + 3]]) as usize);
        let v = &b[o + 4..(o + 4 + l).min(end)];
        if v.len() >= 8 && v[1] == 0x01 {
            let port = u16::from_be_bytes([v[2], v[3]]);
            let ip = [v[4], v[5], v[6], v[7]];
            if t == 0x0020 {   // XOR-MAPPED-ADDRESS
                let c = 0x2112A442u32.to_be_bytes();
                return Some(std::net::SocketAddrV4::new([ip[0] ^ c[0], ip[1] ^ c[1], ip[2] ^ c[2], ip[3] ^ c[3]].into(), port ^ 0x2112));
            }
            if t == 0x0001 { plain = Some(std::net::SocketAddrV4::new(ip.into(), port)); }   // MAPPED-ADDRESS (old servers)
        }
        o += 4 + ((l + 3) & !3);
    }
    plain
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn audio_round_trips_16_and_32_bit() {
        let planes = vec![(0..64).map(|i| (i as f32 / 64.0) - 0.5).collect::<Vec<f32>>()];
        let p = Packet { kind: AUDIO, token: 0xfeed, seq: 9, time_ms: 1234.5, bits: 32, planes: planes.clone() };
        assert_eq!(decode(&encode(&p)), Some(p));
        let q = decode(&encode(&Packet { kind: AUDIO, token: 1, seq: 1, time_ms: 0.0, bits: 16, planes: planes.clone() })).unwrap();
        assert_eq!(q.bits, 16); assert!(q.planes[0].iter().zip(&planes[0]).all(|(a, b)| (a - b).abs() < 1.0 / 16000.0));
        assert_eq!(encode(&Packet { kind: AUDIO, token: 1, seq: 1, time_ms: 0.0, bits: 16, planes }).len(), HEADER + 64 * 2, "16-bit mono 64 frames: 160 bytes");
    }
    #[test] fn probes_and_junk() {
        let p = Packet { kind: PROBE, token: 42, seq: 0, time_ms: 0.0, bits: 16, planes: vec![] };
        assert_eq!(decode(&encode(&p)).map(|x| (x.kind, x.token)), Some((PROBE, 42)));
        let good = encode(&Packet { kind: AUDIO, token: 1, seq: 1, time_ms: 0.0, bits: 16, planes: vec![vec![0.1; 64]] });
        assert!(decode(&good[..good.len() - 1]).is_none(), "truncated");
        let mut bad = good.clone(); bad[0] = b'X'; assert!(decode(&bad).is_none());
        assert!(decode(b"hello").is_none());
    }
    #[test] fn sequence_wraps() { assert_eq!(seq_delta(u32::MAX, 1), 2); assert_eq!(seq_delta(5, 3), -2); }
    #[test] fn concealment_fades() {
        let f = conceal(&[vec![1.0; 64]], 2);
        assert_eq!(f.len(), 2); assert!((f[0][0][0] - 1.0).abs() < 1e-6); assert!(f[1][0][63] < 0.4);
    }
    #[test] fn reads_a_stun_answer() {
        let tx = [7u8; 12];
        assert_eq!(stun_request(tx)[0..2], [0, 1]);
        // success response with XOR-MAPPED-ADDRESS 203.0.113.5:40000
        let c = 0x2112A442u32.to_be_bytes();
        let mut b = vec![0x01, 0x01, 0, 12]; b.extend_from_slice(&c); b.extend_from_slice(&tx);
        b.extend_from_slice(&[0x00, 0x20, 0, 8, 0, 1]); b.extend_from_slice(&(40000u16 ^ 0x2112).to_be_bytes());
        b.extend_from_slice(&[203 ^ c[0], 0 ^ c[1], 113 ^ c[2], 5 ^ c[3]]);
        assert_eq!(stun_mapped(&b, tx), Some("203.0.113.5:40000".parse().unwrap()));
        assert_eq!(stun_mapped(&b, [0; 12]), None, "someone else's answer");
    }
}
