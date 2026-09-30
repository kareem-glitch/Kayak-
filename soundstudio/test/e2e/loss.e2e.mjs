// End-to-end: a lossy link (2% of audio packets lost, like a long-distance
// Wi-Fi call). Lost blocks are filled in, so the other player's audio keeps
// its timing: few dropouts, and the buffer (the delay) stays small.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('lossy link: lost blocks are filled in, few dropouts', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await B.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await B.evaluate(() => window.jamNet.setFakeLoss(0.02));
    await sleep(3000);
    const before = await B.evaluate(() => ({ under: window.jamStats.under, filled: [...window.jamPeers.values()][0].filled || 0 }));
    await sleep(10000);
    const after = await B.evaluate(() => ({ under: window.jamStats.under, filled: [...window.jamPeers.values()][0].filled || 0 }));
    assert.ok(after.filled - before.filled > 20, `lost blocks filled in (${after.filled - before.filled} in 10 s)`);
    assert.ok(after.under - before.under < 15, `few dropouts (${after.under - before.under} in 10 s; about 25 without filling)`);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
