// Audio hub wire format (the open-source JackTrip packet format).
// Every packet is a 16-byte little-endian header followed by planar audio:
// all N frames of channel 0, then all N frames of channel 1, and so on.
//
//  offset size field
//   0     8    timestamp, microseconds since the Unix epoch
//   8     2    sequence number (wraps at 65536)
//  10     2    frames per packet (N)
//  12     1    sample-rate code (48000 Hz = 3)
//  13     1    bits per sample (16 here: signed little-endian integers)
//  14     1    channels the sender wants back from the hub
//  15     1    channels in this payload: 0 = same as byte 14, 255 = no audio
//
// No imports and no DOM, so it runs in the page, in an AudioWorklet, and in Node tests.

export const HEADER_BYTES = 16;
const RATE_CODES = [22050, 32000, 44100, 48000, 88200, 96000, 192000];

export function rateCode(hz) {
  const i = RATE_CODES.indexOf(hz);
  if (i < 0) throw new Error('Unsupported sample rate ' + hz);
  return i;
}

export function packetBytes(frames, channels, bits = 16) {
  return HEADER_BYTES + frames * channels * (bits / 8);
}

// Writes one packet into `out` (a Uint8Array at least packetBytes() long).
// `planes` is an array of Float32Array, one per channel, each `frames` long.
export function encodePacket(out, { seq, timeUs, sampleRate, frames, wantChannels, planes }) {
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const sending = planes.length;
  dv.setBigUint64(0, BigInt(Math.floor(timeUs)), true);
  dv.setUint16(8, seq & 0xffff, true);
  dv.setUint16(10, frames, true);
  dv.setUint8(12, rateCode(sampleRate));
  dv.setUint8(13, 16);
  dv.setUint8(14, wantChannels);
  dv.setUint8(15, sending === wantChannels ? 0 : sending);
  let o = HEADER_BYTES;
  for (const plane of planes) {
    for (let i = 0; i < frames; i++, o += 2) {
      const s = plane[i];
      dv.setInt16(o, s >= 1 ? 32767 : s <= -1 ? -32768 : Math.round(s * 32767), true);
    }
  }
  return o;
}

// Parses a packet. Returns null for anything malformed (never throws on bad
// input: packets come off the network). The channel count is taken from the
// payload size, so it works whatever the sender put in bytes 14 and 15.
export function decodePacket(bytes) {
  if (bytes.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = dv.getUint16(10, true);
  const bits = dv.getUint8(13);
  if (!frames || bits !== 16) return null;
  const payload = bytes.byteLength - HEADER_BYTES;
  const channels = payload / (frames * 2);
  if (!Number.isInteger(channels) || channels < 1 || channels > 16) return null;
  const planes = [];
  let o = HEADER_BYTES;
  for (let c = 0; c < channels; c++) {
    const plane = new Float32Array(frames);
    for (let i = 0; i < frames; i++, o += 2) plane[i] = dv.getInt16(o, true) / 32768;
    planes.push(plane);
  }
  return {
    timeUs: Number(dv.getBigUint64(0, true)),
    seq: dv.getUint16(8, true),
    frames,
    sampleRate: RATE_CODES[dv.getUint8(12)] || 0,
    planes,
  };
}

// Signed distance from sequence number a to b, handling 16-bit wraparound.
export function seqDelta(a, b) {
  return ((b - a + 32768) & 0xffff) - 32768;
}
