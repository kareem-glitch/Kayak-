// Adaptive jitter buffer (app/audio/worklet.js) against simulated networks.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.AudioWorkletProcessor = class { constructor(){ this.port = { postMessage(){}, onmessage:null }; } };
globalThis.sampleRate = 48000;
const { Player, FEELS } = await import('../app/audio/worklet.js');

// Deliver 128-frame blocks of a 440 Hz tone. `arrive(i)` gives block i's arrival
// time in render quanta (fractional); `clock` scales the sender's rate (drift).
function simulate({ seconds = 20, arrive, limitBlocks = 16, drop = () => false, feel }){
  const p = new Player(limitBlocks * 128, feel), quanta = Math.round(seconds * 375);
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

test('feel: tight keeps less buffer than balanced, smooth keeps more and drops out least', () => {
  const run = f => simulate({ arrive: jitter(6, 7), seconds: 40, feel: FEELS[f] });
  const t = run('tight'), b = run('balanced'), s = run('smooth');
  assert.ok(t.bufferMs < b.bufferMs && b.bufferMs < s.bufferMs, `buffers ${t.bufferMs} / ${b.bufferMs} / ${s.bufferMs} ms`);
  assert.ok(s.dropouts <= b.dropouts && b.dropouts <= t.dropouts + 1, `dropouts ${t.dropouts} / ${b.dropouts} / ${s.dropouts}`);
  assert.equal(s.clicks, 0);
});

test('feel: live (timing first) keeps the least buffer, and dropouts fade instead of clicking', () => {
  const steady = simulate({ arrive: i => i, seconds: 30, feel: FEELS.live }), tight = simulate({ arrive: i => i, seconds: 30, feel: FEELS.tight });
  assert.ok(steady.bufferMs <= 4.1 && steady.bufferMs < tight.bufferMs, `steady link: ${steady.bufferMs} ms (tight ${tight.bufferMs})`);
  assert.equal(steady.dropouts, 0);
  const j = simulate({ arrive: jitter(6, 7), seconds: 40, feel: FEELS.live }), jt = simulate({ arrive: jitter(6, 7), seconds: 40, feel: FEELS.tight });
  assert.ok(j.bufferMs <= jt.bufferMs + 0.5 && j.dropouts <= jt.dropouts + 2, `jittery link: live ${j.bufferMs} ms / ${j.dropouts} dropouts vs tight ${jt.bufferMs} ms / ${jt.dropouts}`);
  assert.equal(j.clicks, 0, 'dropouts are faded');
});

// Far-apart playback (Trade bars): blocks play at the exact frame they're scheduled for.
const { DelayPlayer } = await import('../app/audio/worklet.js');
test('scheduled player: plays each block at its frame, smooth through drift, drops the too-late', () => {
  const p = new DelayPlayer(), out = [], lead = 4800;   // heard 100 ms after it's sent
  let phase = 0, frame = 0, clicks = 0, prev = 0;
  const block = () => { const b = new Float32Array(128); for(let i = 0; i < 128; i++) b[i] = 0.5 * Math.sin(phase += 2 * Math.PI * 440 / 48000); return b; };
  for(let q = 0; q < 3000; q++){   // 8 s; the sender's clock runs 0.02 % fast, and arrival jitters
    const at = frame + lead + q * 128 * 0.0002 + (q % 7) * 3;
    p.push([block()], at, frame);
    const L = new Float32Array(128), R = new Float32Array(128); p.render(L, R, frame); frame += 128;
    for(const v of L){ if(q > 40 && Math.abs(v - prev) > 0.2) clicks++; prev = v; }
    out.push(L[0]);
  }
  assert.equal(out.slice(0, 37).every(v => v === 0), true, 'silent until the first block is due (4800 frames = 37.5 blocks)');
  assert.ok(out.slice(40).every(v => v !== 0), 'then continuous sound');
  assert.equal(clicks, 0, 'no clicks from drift corrections');
  assert.equal(p.late, 0);
  p.push([block()], frame - 500, frame); assert.equal(p.late, 1, 'a block that is already overdue is dropped');
});
