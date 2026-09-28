// End-to-end: built-in tones. Renders a guitar-level test tone through the full
// chain (neural amp model -> cabinet -> EQ -> level) in Chromium and checks the
// amps behave like amps; then picks a tone in a room and checks your signal
// still reaches the room through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('built-in tones: clean stays clean, crunch distorts, levels match, the room gets it', { timeout: 120000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Player');
    await A.goto(h.base);
    const labels = await A.$$eval('[data-tone]', bs => bs.map(b => b.textContent));
    assert.deepEqual(labels, ['Off (DI)', 'Clean', 'Warm', 'Crunch', 'Lead', 'Bass']);

    // render 220 Hz at -12 dBFS (a firmly played guitar DI) through each chain and look at the result
    const r = await A.evaluate(async () => {
      const { createToneChain } = await import('/app/audio/tone.js');
      const out = {};
      for(const id of ['clean', 'crunch', 'lead']){
        const ctx = new AudioContext({ sampleRate: 48000 }); await ctx.resume();
        const chain = await createToneChain(ctx); await chain.set(id);
        const osc = ctx.createOscillator(), g = ctx.createGain(), an = ctx.createAnalyser(); osc.frequency.value = 220; g.gain.value = 0.25; an.fftSize = 32768;
        osc.connect(g).connect(chain.input); chain.output.connect(an); osc.start();
        await new Promise(r => setTimeout(r, 1200));
        const y = new Float32Array(an.fftSize); an.getFloatTimeDomainData(y); ctx.close();
        const gz = f => { let s1 = 0, s2 = 0; const c = 2 * Math.cos(2 * Math.PI * f / 48000); for(const v of y){ const s = v + c * s1 - s2; s2 = s1; s1 = s; } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)); };
        let hsum = 0; for(let k = 2; k <= 8; k++) hsum += gz(220 * k) ** 2;
        const rms = Math.sqrt(y.reduce((a, v) => a + v * v, 0) / y.length);
        out[id] = { thd: Math.sqrt(hsum) / gz(220), db: 20 * Math.log10(rms) };
      }
      return out;
    });
    assert.ok(r.clean.thd < 0.1, `clean stays clean (THD ${(r.clean.thd * 100).toFixed(1)}%)`);
    assert.ok(r.crunch.thd > 0.1 && r.crunch.thd > 3 * r.clean.thd, `crunch distorts (THD ${(r.crunch.thd * 100).toFixed(1)}% vs clean ${(r.clean.thd * 100).toFixed(1)}%; the cab rounds off the top)`);
    const dbs = Object.values(r).map(x => x.db);
    assert.ok(Math.max(...dbs) - Math.min(...dbs) < 12, `tones sit at similar levels (${dbs.map(d => d.toFixed(1)).join(', ')} dB)`);

    // in a room: pick Crunch; your (fake) mic still reaches the jam through the amp
    await A.fill('#nameInput', 'Player'); await A.click('#joinBtn');
    await A.waitForSelector('#roomView:not([hidden])');
    await A.click('[data-tone="crunch"]');
    await A.waitForFunction(() => /direct monitoring/.test(document.getElementById('toneNote').textContent), null, { timeout: 20000 });
    await sleep(1500);
    assert.ok(await A.evaluate(() => window.jamStats.inPeak) > 0.001, 'your signal flows through the tone');
    assert.equal(await A.evaluate(() => document.getElementById('eqBox').hidden), false, 'EQ shows for a tone');
    await A.click('[data-tone="off"]'); await sleep(300);
    assert.equal(await A.evaluate(() => document.getElementById('eqBox').hidden), true, 'no EQ for Off (DI)');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
