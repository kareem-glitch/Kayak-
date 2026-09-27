import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePacket, decodePacket, packetBytes, seqDelta, HEADER_BYTES } from '../audio/hub-protocol.js';

test('header layout matches the hub (16 bytes, little-endian)', () => {
  const out = new Uint8Array(packetBytes(128, 1));
  const n = encodePacket(out, { seq: 0x1234, timeUs: 1_700_000_000_123_456, sampleRate: 48000, frames: 128, wantChannels: 2, planes: [new Float32Array(128)] });
  assert.equal(n, 16 + 256);
  assert.deepEqual([...out.slice(8, 16)], [0x34, 0x12, 128, 0, 3, 16, 2, 1]);
  assert.equal(new DataView(out.buffer).getBigUint64(0, true), 1_700_000_000_123_456n);
});

test('byte 15 is 0 when sending as many channels as requested back', () => {
  const out = new Uint8Array(packetBytes(4, 2));
  encodePacket(out, { seq: 1, timeUs: 0, sampleRate: 48000, frames: 4, wantChannels: 2, planes: [new Float32Array(4), new Float32Array(4)] });
  assert.equal(out[15], 0);
});

test('payload is planar and round-trips within 16-bit precision', () => {
  const L = Float32Array.from([0, 0.5, -0.5, 1]), R = Float32Array.from([-1, 0.25, 2, -2]);
  const out = new Uint8Array(packetBytes(4, 2));
  encodePacket(out, { seq: 7, timeUs: 5, sampleRate: 48000, frames: 4, wantChannels: 2, planes: [L, R] });
  const dv = new DataView(out.buffer);
  assert.equal(dv.getInt16(HEADER_BYTES + 2, true), Math.round(0.5 * 32767)); // L[1] before any R
  assert.equal(dv.getInt16(HEADER_BYTES + 8, true), -32768); // R[0]
  const p = decodePacket(out);
  assert.equal(p.seq, 7); assert.equal(p.frames, 4); assert.equal(p.sampleRate, 48000); assert.equal(p.planes.length, 2);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(p.planes[0][i] - L[i]) < 1e-4);
    assert.ok(Math.abs(p.planes[1][i] - Math.max(-1, Math.min(1, R[i]))) < 1e-4);
  }
});

test('malformed packets decode to null', () => {
  assert.equal(decodePacket(new Uint8Array(10)), null);
  const bad = new Uint8Array(packetBytes(4, 1) + 1); bad[10] = 4; bad[13] = 16;
  assert.equal(decodePacket(bad), null);
  const zeroFrames = new Uint8Array(packetBytes(4, 1)); zeroFrames[13] = 16;
  assert.equal(decodePacket(zeroFrames), null);
});

test('sequence distance handles wraparound', () => {
  assert.equal(seqDelta(65535, 0), 1);
  assert.equal(seqDelta(0, 65535), -1);
  assert.equal(seqDelta(100, 103), 3);
});

test('32-bit float stereo round-trips exactly', () => {
  const L = Float32Array.from([0.1234567, -0.75, 1.5, -2]), R = Float32Array.from([1e-6, 0, 0.5, -0.5]);
  const out = new Uint8Array(packetBytes(4, 2, 32));
  const n = encodePacket(out, { seq: 9, timeUs: 1, sampleRate: 48000, frames: 4, wantChannels: 1, planes: [L, R], bits: 32 });
  assert.equal(n, HEADER_BYTES + 4 * 2 * 4); assert.equal(out[13], 32); assert.equal(out[15], 2);
  const p = decodePacket(out);
  assert.equal(p.planes.length, 2);
  assert.deepEqual([...p.planes[0]], [...L]); assert.deepEqual([...p.planes[1]], [...R]);
});
