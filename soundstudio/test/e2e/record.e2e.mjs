// End-to-end: record a take while the band plays, then check the playback,
// the download and the timing report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('record and play back a take', { timeout: 120000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Kareem'), B = await h.page('Wife');
    await h.join(A, h.base, 'Kareem');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Wife');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout:30000 });
    await A.click('#claimBtn'); await A.waitForSelector('#hostControls:not([hidden])');
    await A.fill('#prompt', 'Slow funk in E minor, 96 bpm'); await A.click('#genBtn'); await sleep(1500);
    await A.uncheck('#countIn'); await A.click('#playBtn'); await sleep(2000);

    await A.click('#recBtn'); await sleep(5000);
    assert.match(await A.textContent('#recStatus'), /^0:0[45]$/, 'timer runs while recording');
    await A.click('#recBtn');
    await A.waitForSelector('#recResult:not([hidden])', { timeout:10000 });
    const r = await A.evaluate(async () => {
      const a = document.getElementById('recAudio');
      if(!(a.duration > 0)) await new Promise(res => a.addEventListener('loadedmetadata', res, { once:true }));
      const wav = await (await fetch(document.getElementById('recDownload').href)).arrayBuffer();
      return { duration: a.duration, bytes: wav.byteLength, channels: new DataView(wav).getUint16(22, true),
        report: document.getElementById('recReport').textContent, status: document.getElementById('recStatus').textContent };
    });
    assert.ok(r.duration > 4.5 && r.duration < 6, `take is about 5 s long (${r.duration})`);
    assert.equal(r.channels, 2, 'stereo take (you / the others)');
    assert.ok(r.bytes > 44 + 4.5 * 48000 * 4, `WAV holds the audio (${r.bytes} bytes)`);
    assert.match(r.report, /You.*Others, as you heard them.*Measured over \d+ beats|Same clap/s, `timing report shown (${r.report})`);
    assert.match(r.status, /s recorded/);

    // recording without the band still gives a playable take
    await A.click('#playBtn'); await sleep(500);
    await A.click('#recBtn'); await sleep(1500); await A.click('#recBtn');
    await A.waitForFunction(() => /Start the band|recorded almost nothing/.test(document.getElementById('recReport').textContent), null, { timeout:10000 });
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
