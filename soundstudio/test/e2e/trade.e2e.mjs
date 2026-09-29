// End-to-end: Trade bars. Two players trade 4s over a stock track (Indie rock,
// 120 bpm, so a turn is 8 s). Checks the turns alternate the same way on both
// devices, only the player whose turn it is gets through, the listener's band
// runs behind the soloist's by the delay they're heard with, and nothing
// arrives too late to play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('trade bars: turns alternate, only the soloist is heard, on the beat', { timeout: 150000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host', { band: 'stems' }), B = await h.page('Guest', { band: 'stems' });
    await h.join(A, h.base, 'Host');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await B.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await A.waitForSelector('#hostControls:not([hidden])', { state: 'attached' });   // the room's creator runs the band
    await h.drawer(A, 'band'); await A.waitForSelector('#stock-rock-d-120'); await A.click('#stock-rock-d-120');
    await A.waitForFunction(() => /Indie rock/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
    await A.click('[data-game="4"]');
    await B.waitForFunction(() => document.querySelector('[data-game="4"]').getAttribute('aria-checked') === 'true', null, { timeout: 5000 });
    await B.click('#avatarBtn');   // the guest plays as a pixel character
    await A.click('#playBtn');
    await B.waitForFunction(() => window.jamStems.playing(), null, { timeout: 15000 });

    // a snapshot in the middle of each of the first three turns
    const peek = p => p.evaluate(() => {
      const t = window.jamTrade.info(), other = [...window.jamPeers.values()][0];
      return { leader: t.leader && t.nameOf(t.leader), mine: t.mine, zero: window.jamStart.zero, base: window.jamStart.base, offset: other.offset,
        muted: other.muted || 0, recv: other.recv, late: Object.values(window.jamStats.players || {}).reduce((a, x) => a + (x.late || 0), 0),
        line: document.getElementById('turnLine').textContent, glow: [...document.querySelectorAll('.tile.onmic .tname')].map(e => e.textContent) };
    });
    const turns = [];
    const t0 = await A.evaluate(() => window.jamStart.base);
    for(const k of [0, 1, 2]){
      const wait = t0 + (k + 0.6) * 8000 - await A.evaluate(() => performance.timeOrigin + performance.now());
      if(wait > 0) await sleep(wait);
      turns.push({ a: await peek(A), b: await peek(B) });
    }
    const order = turns.map(t => t.a.leader);
    assert.ok(order[0] && order[1] && order[0] !== order[1] && order[2] === order[0], `turns alternate (${order})`);
    turns.forEach((t, k) => {
      assert.equal(t.b.leader, t.a.leader, `turn ${k}: both devices agree who's on`);
      assert.notEqual(t.a.mine, t.b.mine, `turn ${k}: exactly one of them is on`);
      const [solo, listener] = t.a.mine ? [t.a, t.b] : [t.b, t.a];
      // listener's band start, on the soloist's clock: later than the soloist's by the delay it hears them with
      const behind = (listener.zero + listener.offset) - solo.zero;
      assert.ok(behind > 0 && behind < 400, `turn ${k}: listener's band runs ${behind.toFixed(1)} ms behind the soloist's`);
      assert.match(t.a.mine ? t.a.line : t.b.line, /Your 4 bars/);
      assert.deepEqual(listener.glow.length, 1, `turn ${k}: the soloist's tile glows for the listener`);
    });
    const avatars = await A.evaluate(() => [...document.querySelectorAll('.tile.avatar .tname')].map(e => e.textContent));
    assert.deepEqual(avatars, ['Guest'], 'the host sees the guest as an avatar');
    if(process.env.SHOT) await A.screenshot({ path: process.env.SHOT });
    const last = turns[2];
    assert.ok(last.a.muted > 100 && last.b.muted > 100, `off-turn playing isn't heard (${last.a.muted}, ${last.b.muted} blocks held back)`);
    assert.ok(last.a.late + last.b.late < 20, `the soloist's audio arrives in time to play on the beat (late blocks: ${last.a.late + last.b.late})`);

    // back to free jam: everyone returns to the shared timing
    await h.drawer(A, 'band'); await A.click('[data-game="free"]'); await sleep(3000);
    const fa = await peek(A), fb = await peek(B);
    assert.ok(Math.abs(fa.zero - fa.base) < 2 && Math.abs(fb.zero - fb.base) < 2, 'free jam: back on the room’s shared timing');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
