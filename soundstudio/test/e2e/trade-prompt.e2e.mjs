// End-to-end: BARS over a prompted track, the guest on keys. The host shares the
// track a piece at a time and the band waits until the guest has it; then the
// host hears the guest on the guest's turns (and not on their own).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';
test('prompted track in BARS: the band waits for everyone, the keys player is heard on their turns', { timeout: 150000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host', { band: 'stems' }), B = await h.page('Guest', { band: 'stems' });
    await B.addInitScript(() => localStorage.setItem('ss.part', 'keys'));
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await A.waitForSelector('#hostControls:not([hidden])', { state: 'attached' });
    await h.drawer(A, 'band'); await A.click('#mode-prompt'); await A.fill('#prompt', 'Slow funk in E minor, 96 bpm'); await A.click('#genBtn');
    await A.waitForFunction(() => /ready/.test(document.getElementById('genStatus').textContent), null, { timeout: 30000 });
    await A.click('[data-game="4"]'); await sleep(300);
    await A.click('#playBtn');   // straight away: the band waits until the guest has the whole track
    await B.waitForFunction(() => window.jamStems.playing() && window.jamStems.debug() && Object.keys(window.jamStems.debug().lengths).length === 4, null, { timeout: 40000 });
    const heard = { Guest: [], Host: [] };
    for(let s = 0; s < 6; s++){
      await sleep(3000);
      const r = await A.evaluate(async () => { const t = window.jamTrade.info(), id = [...window.jamPeers.keys()][0]; let mx = 0; for(let i = 0; i < 100; i++){ mx = Math.max(mx, window.jamLevel(id)); await new Promise(r => setTimeout(r, 20)); } return { leader: t.leader && t.nameOf(t.leader), lvl: mx }; });
      if(r.leader) heard[r.leader].push(r.lvl);
    }
    assert.ok(heard.Guest.length && heard.Guest.some(v => v > 0.3), `the host hears the guest on the guest's turns (${heard.Guest})`);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
