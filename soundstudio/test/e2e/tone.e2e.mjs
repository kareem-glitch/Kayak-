// End-to-end: built-in tones. Renders a guitar-level test tone through the full
// chain (neural amp model -> cabinet -> EQ -> level) in Chromium and checks the
// amps behave like amps; then picks a tone in a room and checks your signal
// still reaches the room through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('built-in tones: each amp has its own character, chorus and reverb work, the room gets it', { timeout: 120000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Player');
    await A.goto(h.base);
    const labels = await A.$$eval('[data-tone]', bs => bs.map(b => b.textContent));
    assert.deepEqual(labels, ['Off (DI)', 'Clean', 'Warm', 'Crunch', 'Lead', 'Bass']);

    // each amp through the full chain, played softly (-30 dBFS) and firmly (-12 dBFS)
    const r = await A.evaluate(async () => {
      const { createToneChain } = await import('/app/audio/tone.js');
      const measure = async (id, amp, fx) => {
        const ctx = new AudioContext({ sampleRate: 48000 }); await ctx.resume();
        const chain = await createToneChain(ctx); await chain.set(id); if(fx) chain.setEq(fx);
        const osc = ctx.createOscillator(), g = ctx.createGain(), split = ctx.createChannelSplitter(2), aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
        osc.frequency.value = 220; g.gain.value = amp; aL.fftSize = aR.fftSize = 32768;
        osc.connect(g).connect(chain.input); chain.output.connect(split); split.connect(aL, 0); split.connect(aR, 1); osc.start();
        await new Promise(r => setTimeout(r, 1200));
        const y = new Float32Array(aL.fftSize), z = new Float32Array(aR.fftSize); aL.getFloatTimeDomainData(y); aR.getFloatTimeDomainData(z);
        g.gain.value = 0; await new Promise(r => setTimeout(r, 900));   // stop playing: is anything still ringing?
        const tail = new Float32Array(aL.fftSize); aL.getFloatTimeDomainData(tail);
        const stereo = chain.stereo && z.some(v => Math.abs(v) > 1e-3) && y.some((v, i) => Math.abs(v - z[i]) > 1e-4);   // both sides sound, and differ
        ctx.close();
        const gz = f => { let s1 = 0, s2 = 0; const c = 2 * Math.cos(2 * Math.PI * f / 48000); for(const v of y){ const q = v + c * s1 - s2; s2 = s1; s1 = q; } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)); };
        let h = 0; for(let k = 2; k <= 8; k++) h += gz(220 * k) ** 2;
        const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
        return { thd: Math.sqrt(h) / gz(220), db: 20 * Math.log10(rms(y)), stereo, tailDb: 20 * Math.log10(rms(tail) + 1e-9) };
      };
      const out = {}, dry = { chorus: 0, reverb: 0 };
      for(const id of ['clean', 'warm', 'crunch', 'lead']) out[id] = { soft: await measure(id, 0.0316, dry), firm: await measure(id, 0.25, dry) };
      out.chorus = await measure('clean', 0.25, { chorus: 60, reverb: 0 });
      out.reverb = await measure('warm', 0.25, { chorus: 0, reverb: 60 });
      return out;
    });
    const pct = x => (x * 100).toFixed(0) + '%';
    assert.ok(r.clean.soft.thd < 0.05 && r.clean.firm.thd < 0.05, `Clean never breaks up (${pct(r.clean.soft.thd)}, ${pct(r.clean.firm.thd)})`);
    assert.ok(r.warm.soft.thd < 0.08 && r.warm.firm.thd > 2 * r.warm.soft.thd, `Warm is clean until you dig in (${pct(r.warm.soft.thd)} soft, ${pct(r.warm.firm.thd)} firm)`);
    assert.ok(r.crunch.firm.thd > r.warm.firm.thd, `Crunch bites harder than Warm when you dig in (${pct(r.crunch.soft.thd)} soft, ${pct(r.crunch.firm.thd)} firm)`);
    // saturation, as the ear hears it: playing 18 dB harder barely gets louder
    const swing = id => r[id].firm.db - r[id].soft.db;
    assert.ok(swing('lead') < 2 && swing('lead') < swing('crunch') - 2 && swing('crunch') < swing('warm') && swing('clean') > 15, `Each amp responds differently to your picking; Lead is the most saturated: 18 dB harder picking gets ${swing('lead').toFixed(1)} dB louder (Crunch ${swing('crunch').toFixed(1)}, Warm ${swing('warm').toFixed(1)}, Clean ${swing('clean').toFixed(1)})`);
    const firm = ['clean', 'warm', 'crunch', 'lead'].map(id => r[id].firm.db);
    assert.ok(Math.max(...firm) - Math.min(...firm) < 12, `amps sit at similar levels (${firm.map(d => d.toFixed(1)).join(', ')} dB)`);
    assert.ok(!r.clean.firm.stereo && r.chorus.stereo, 'chorus spreads the sound into stereo; with no effects it stays mono');
    assert.ok(r.reverb.tailDb > r.warm.firm.tailDb + 20, `reverb rings on after you stop (${r.reverb.tailDb.toFixed(0)} dB vs ${r.warm.firm.tailDb.toFixed(0)} dB dry)`);

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
