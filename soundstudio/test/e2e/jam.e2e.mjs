// End-to-end: a room of 4 in headless Chromium. Checks video and audio between
// everyone, a synced band (including someone who joins mid-song), seats muting
// a part on every device, and a 5th person being turned away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('four players jam; fifth is refused', { timeout: 240000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Kareem'); await h.join(A, h.base, 'Kareem');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    const link = await A.evaluate(() => location.href);
    assert.match(link, /join=/, 'address bar shows the invite link');
    const B = await h.page('Wife'), C = await h.page('Sam');
    await h.join(B, link, 'Wife'); await sleep(2500); await h.join(C, link, 'Sam'); await sleep(4000);

    await A.waitForSelector('#hostControls:not([hidden])');   // the room's creator runs the band
    await A.fill('#prompt', 'Slow funk in E minor, 96 bpm'); await A.click('#genBtn'); await sleep(1500);
    await A.uncheck('#countIn'); await A.click('#playBtn'); await sleep(2500);
    const D = await h.page('Dee'); await h.join(D, link, 'Dee'); await sleep(6000);   // joins mid-song
    await C.click('[data-seat="keys"]'); await sleep(1500);

    const players = [['Kareem', A], ['Wife', B], ['Sam', C], ['Dee', D]];
    const snaps = await Promise.all(players.map(([, p]) => p.evaluate(() => ({
      videos: [...document.querySelectorAll('.tile video')].filter(v => v.videoWidth > 0).length,
      heard: [...window.jamPeers.values()].map(p => p.recv),
      zero: window.jamStart && window.jamStart.zero,
      keys: window.jamEngine() && window.jamEngine().keys.ch.volume.value,
    }))));
    snaps.forEach((s, i) => {
      const n = players[i][0];
      assert.equal(s.videos, 4, `${n} sees 4 cameras`);
      assert.equal(s.heard.length, 3, `${n} is connected to 3 others`);
      s.heard.forEach(r => assert.ok(r > 100, `${n} receives audio from everyone (${s.heard})`));
      assert.equal(s.keys, -Infinity, `${n}'s band has the keys muted (Sam took the seat)`);
    });
    const zeros = snaps.map(s => s.zero);
    assert.ok(Math.max(...zeros) - Math.min(...zeros) < 40, `bands agree on bar 1 within 40 ms (${zeros.map(z => Math.round(z - zeros[0]))})`);

    const E = await h.page('Fifth'); await h.join(E, link, 'Fifth');
    await E.waitForFunction(() => /full/.test(document.getElementById('connStats').textContent), null, { timeout:30000 });
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
