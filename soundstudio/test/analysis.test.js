import test from 'node:test';
import assert from 'node:assert/strict';
import { onsets, beatOffsets, median, wav } from '../app/audio/analysis.js';

const SR = 48000;
// A track of short claps (noise bursts) at the given times, with light background noise.
function claps(times, seconds = 6){
  const t = new Float32Array(SR * seconds); let x = 1;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for(let i = 0; i < t.length; i++) t[i] = rnd() * 0.002;
  for(const c of times){ const s = Math.round(c * SR); for(let i = 0; i < 1200; i++) t[s + i] += rnd() * 0.6 * Math.exp(-i / 300); }
  return t;
}

test('onsets are found within 1 ms of each clap', () => {
  const truth = [0.5, 1.0, 1.5, 2.25, 3.0];
  const found = onsets(claps(truth), SR);
  assert.equal(found.length, truth.length);
  found.forEach((f, i) => assert.ok(Math.abs(f - truth[i]) < 0.001, `${f} vs ${truth[i]}`));
});

test('playing 28 ms behind a 120 bpm beat measures as +28 ms', () => {
  const beats = Array.from({ length: 10 }, (_, k) => 0.5 + k * 0.5);
  const offs = beatOffsets(onsets(claps(beats.map(b => b + 0.028)), SR), beats);
  assert.equal(offs.length, 10);
  assert.ok(Math.abs(median(offs) - 28) < 1, `median ${median(offs)}`);
});

test('off-beat notes are ignored, early notes are negative', () => {
  const beats = [0.5, 1.0, 1.5, 2.0];
  const offs = beatOffsets([0.49, 0.75, 1.495, 2.25], beats);
  assert.deepEqual(offs.map(Math.round), [-10, -5]);
});

test('silence gives no onsets', () => { assert.deepEqual(onsets(new Float32Array(SR), SR), []); });

test('wav header and length', () => {
  const buf = wav(new Float32Array(100), new Float32Array(100), SR), dv = new DataView(buf);
  assert.equal(buf.byteLength, 44 + 400);
  assert.equal(String.fromCharCode(...new Uint8Array(buf, 0, 4)), 'RIFF');
  assert.equal(dv.getUint32(24, true), SR); assert.equal(dv.getUint16(22, true), 2);
});
