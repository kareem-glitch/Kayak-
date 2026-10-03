// End-to-end: the whole-jam recording is clean. Two players (the test tone from each
// fake mic), no band; the recording is decoded and checked for clicks: sudden jumps
// in what should be smooth tones (the "grain" when the recording ran dry).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// a clean 440 Hz tone as every fake microphone (Chromium's own test beep is clipped)
function sineWav(){
  const sr = 48000, n = sr * 20, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for(let i = 0; i < n; i++) b.writeInt16LE(Math.round(0.3 * 32767 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2);
  const f = path.join(os.tmpdir(), 'airband-sine440.wav'); fs.writeFileSync(f, b); return f;
}
test('record the whole jam: no clicks', { timeout: 120000 }, async () => {
  const h = await startServers({ fakeAudio: sineWav() });
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 300), null, { timeout: 30000 });
    const res = {};
    for(const what of ['all', 'video']){
      await h.drawer(A, 'record'); await A.selectOption('#recWhat', what);
      await A.click('#recBtn'); await sleep(6000); await A.click('#recBtn');
      await A.waitForFunction(() => /recorded/.test(document.getElementById('recStatus').textContent), null, { timeout: 20000 });
      res[what] = await A.evaluate(async () => {
        const buf = await (await fetch(document.getElementById('recDownload').href)).arrayBuffer();
        const ab = await new AudioContext({ sampleRate: 48000 }).decodeAudioData(buf), x = ab.getChannelData(0);
        let pk = 0; for(const v of x) pk = Math.max(pk, Math.abs(v));
        let clicks = 0, last = -1e9;
        for(let i = 2; i < x.length; i++){ const d2 = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]); if(d2 > 0.3 * pk && i - last > 64){ clicks++; last = i; } }
        return { seconds: x.length / 48000, peak: pk, clicks };
      });
    }
    for(const [w, r] of Object.entries(res)){ assert.ok(r.peak > 0.05, `${w}: something was recorded`); assert.ok(r.clicks < 15, `${w}: no clicks (${r.clicks} in ${r.seconds.toFixed(1)} s; it was 120+ with video when drawing the picture starved the recorder)`); }
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
