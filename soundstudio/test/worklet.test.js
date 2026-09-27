// Adaptive jitter buffer (app/audio/worklet.js) against simulated networks.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.AudioWorkletProcessor = class { constructor(){ this.port = { postMessage(){}, onmessage:null }; } };
globalThis.sampleRate = 48000;
const { Player } = await import('../app/audio/worklet.js');

// Deliver 128-frame blocks of a 440 Hz tone. `arrive(i)` gives block i's arrival
// time in render quanta (fractional); `clock` scales the sender's rate (drift).
function simulate({ seconds = 20, arrive, limitBlocks = 16, drop = () => false }){
  const p = new Player(limitBlocks * 128), quanta = Math.round(seconds * 375);
  const pending = []; let sent = 0, dropouts = 0, clicks = 0, prev = 0, phase = 0;
  for(let q = 0; q < quanta; q++){
    while(arrive(sent) <= q){ const b = new Float32Array(128); for(let i = 0; i < 128; i++) b[i] = 0.5 * Math.sin(phase += 2 * Math.PI * 440 / 48000); if(!drop(sent)) pending.push(b); sent++; }
    while(pending.length) p.push([pending.shift()]);
    const L = new Float32Array(128), R = new Float32Array(128);
    if(p.render(L, R)) dropouts++;
    for(const v of L){ if(Math.abs(v - prev) > 0.2) clicks++; prev = v; }   // a 440 Hz sine at 0.5 never jumps > 0.03/sample
  }
  return { dropouts, clicks, bufferMs: p.target / 48, rate: p.rate };
}
const jitter = (ms, seed = 1) => { let x = seed; const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647); return i => i + rnd() * ms / 2.667; };

test('steady network: buffer shrinks to its 5.7 ms floor, no dropouts or clicks', () => {
  const r = simulate({ arrive: i => i, seconds: 40 });
  assert.equal(r.dropouts, 0); assert.equal(r.clicks, 0);
  assert.ok(r.bufferMs <= 6, `buffer ${r.bufferMs} ms`);
});

test('5 ms of jitter: buffer settles just above the jitter with no dropouts after it settles', () => {
  const r = simulate({ arrive: jitter(5), seconds: 30 });
  assert.ok(r.bufferMs >= 4 && r.bufferMs <= 12, `buffer ${r.bufferMs} ms`);
  assert.ok(r.dropouts <= 3, `dropouts ${r.dropouts}`);
});

test('clock drift of 100 ppm either way is absorbed without dropouts', () => {
  for(const ppm of [100, -100]){
    const r = simulate({ arrive: i => i * (1 + ppm / 1e6), seconds: 60 });
    assert.equal(r.dropouts, 0, `${ppm} ppm`);
    assert.ok(r.bufferMs <= 6, `${ppm} ppm buffer ${r.bufferMs} ms`);
  }
});

test('a lost packet is concealed with a fade, not a click', () => {
  const r = simulate({ arrive: i => i + 2, drop: i => i === 3000 });
  assert.ok(r.dropouts <= 1, `dropouts ${r.dropouts}`);
  assert.ok(r.clicks <= 2, `clicks ${r.clicks}`);
});

test('the buffer never exceeds the user limit', () => {
  const r = simulate({ arrive: jitter(40), limitBlocks: 4, seconds: 10 });
  assert.ok(r.bufferMs <= 4 * 128 / 48 + 0.01, `buffer ${r.bufferMs} ms`);
});
