// End-to-end: the sound check on the join screen. Start your audio before
// joining, see your level, hear yourself, get the right amp advice for what you
// play; then Join carries on with the same audio and the room hears you.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

const SHOTS = process.env.SHOTS;
test('sound check before joining: level, hear yourself, amp advice, then the room hears you', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    await A.goto(h.base);
    assert.ok(await A.isHidden('#scBody'), 'nothing to set up until you ask');
    await A.click('#scStart');
    await A.waitForSelector('#scBody:not([hidden])', { timeout: 15000 });
    assert.ok(await A.locator('#scIn option').count() > 0, 'your inputs are listed');
    await A.waitForFunction(() => /We hear you|Too loud/.test(document.getElementById('scMsg').textContent), null, { timeout: 10000 });
    assert.ok(await A.evaluate(() => document.getElementById('soundCheck').classList.contains('ok')), 'marked ready');

    // amp advice follows what you play
    await A.click('[data-part="keys"]');
    assert.match(await A.textContent('#scAmpNote'), /Keys: keep “No amp”/);
    assert.equal(await A.getAttribute('#scAmps [data-tone="off"]', 'aria-checked'), 'true', 'No amp is picked');
    assert.equal(await A.textContent('#scAmps [data-tone="off"]'), 'No amp');
    await A.click('[data-part="guitar"]');
    assert.match(await A.textContent('#scAmpNote'), /plugged straight into your interface\? Pick an amp/);

    // hear yourself: your input comes back through air.band's player
    await A.click('#scHear');
    assert.equal(await A.getAttribute('#scHear', 'aria-pressed'), 'true');
    await A.waitForFunction(() => window.jamStats.players && window.jamStats.players.monitor, null, { timeout: 5000 });
    if(SHOTS) await A.screenshot({ path: SHOTS + '/soundcheck.png', fullPage: true });

    // join: same audio carries on, hearing yourself stops, the room hears you
    await A.fill('#nameInput', 'Host'); await A.click('#joinBtn');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await A.waitForFunction(() => !(window.jamStats.players || {}).monitor, null, { timeout: 5000 });
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await B.waitForFunction(() => Object.keys(window.jamStats.players || {}).length > 0, null, { timeout: 30000 });
    await sleep(500);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
