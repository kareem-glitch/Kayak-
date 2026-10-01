// End-to-end: in BARS, the soloist's audio stops arriving mid-turn (they dropped
// out): the AI band takes the rest of their turn, and hands back when they return.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('BARS: the band covers a soloist who drops out', { timeout: 150000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host', { band: 'stems' }), B = await h.page('Guest', { band: 'stems' });
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await A.waitForSelector('#hostControls:not([hidden])', { state: 'attached' });
    await h.drawer(A, 'band'); await A.waitForSelector('#stock-rock-d-120'); await A.click('#stock-rock-d-120');
    await A.waitForFunction(() => /Indie rock/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
    await A.click('[data-game="4"]'); await A.click('#playBtn');
    await B.waitForFunction(() => window.jamStems.playing(), null, { timeout: 15000 });
    // wait for the guest's turn as the host hears it, a bar in
    await A.waitForFunction(() => { const t = window.jamTrade.info(); return t.leader && !t.mine && t.bar >= 1 && t.bar <= 2; }, null, { timeout: 30000, polling: 100 });
    await A.evaluate(() => window.jamNet.setFakeLoss(1));   // the guest's audio stops reaching the host
    await A.waitForFunction(() => window.jamTrade.info().covering, null, { timeout: 5000, polling: 100 });
    assert.match(await A.textContent('#turnLine'), /Guest dropped: the band covers/);
    await A.evaluate(() => window.jamNet.setFakeLoss(0));   // back
    await A.waitForFunction(() => !window.jamTrade.info().covering, null, { timeout: 5000, polling: 100 });
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
