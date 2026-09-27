// End-to-end: Studio quality (32-bit, stereo input) between two players, plus
// the latency estimates, automatic buffer and setup check being shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('studio quality stereo, latency and tips, speaker mode', { timeout: 120000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Kareem'), B = await h.page('Wife');
    await B.addInitScript(() => { localStorage.setItem('ss.studio', '1'); localStorage.setItem('ss.inCh', 'stereo'); });
    await h.join(A, h.base, 'Kareem');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Wife');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout:30000 });
    await sleep(3000);
    const a = await A.evaluate(() => ({
      formats: [...window.jamPeers.values()].map(p => p.format),
      latency: document.getElementById('latList').textContent,
      buffers: Object.values(window.jamStats.players || {}).map(p => p.bufferMs),
      tips: document.getElementById('tips').textContent,
    }));
    const b = await B.evaluate(() => [...window.jamPeers.values()].map(p => p.format));
    // fake mic devices may be mono; stereo is only sent when the input has 2 channels
    assert.match(a.formats[0], /^(1|2)ch\/32bit$/, `Kareem receives Wife's studio-quality audio (${a.formats})`);
    assert.equal(b[0], '1ch/16bit', 'Wife receives Kareem’s standard audio');
    assert.match(a.latency, /Wife → you\s*≈ \d+ ms/, `latency estimate shown (${a.latency})`);
    assert.ok(a.buffers.length === 1 && a.buffers[0] >= 5.6 && a.buffers[0] <= 32, `automatic buffer within limits (${a.buffers})`);
    assert.match(a.tips, /Bluetooth|48 kHz|direct monitoring/, 'setup check shown');
    // Speaker mode: echo cancellation switches on and audio keeps flowing
    assert.equal(await B.evaluate(() => window.jamEchoCancelling()), false, 'headphone mode: no echo cancellation');
    await B.check('#speaker'); await sleep(2000);
    assert.equal(await B.evaluate(() => window.jamEchoCancelling()), true, 'speaker mode: echo cancellation on');
    const before = await A.evaluate(() => [...window.jamPeers.values()][0].recv); await sleep(1500);
    const after = await A.evaluate(() => [...window.jamPeers.values()][0].recv);
    assert.ok(after - before > 300, `audio still flows after switching (${after - before} packets in 1.5 s)`);
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
