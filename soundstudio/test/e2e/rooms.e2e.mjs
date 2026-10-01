// End-to-end: links to rooms that are gone. Your own old room's link (a reload,
// a reopened tab) starts a fresh jam; someone else's ended jam turns into a new
// one of your own (no dead end, no "Someone couldn't be reached").
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('dead room links: your own starts fresh, someone else’s becomes a new jam of yours', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host');
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    const invite = await A.evaluate(() => window.getInvite());
    // the host comes back to their own old link (a new tab: no session memory)
    await A.evaluate(() => sessionStorage.clear());
    await A.goto(invite); await A.fill('#nameInput', 'Host'); await A.click('#joinBtn');
    await A.waitForFunction(() => window.getInvite && window.getInvite(), null, { timeout: 20000 }); await sleep(1500);
    assert.notEqual(await A.evaluate(() => window.getInvite()), invite, 'a fresh room, not the old one');
    assert.equal(await A.isHidden('#notice'), true, 'and no error');
    // someone else opens a link to a room whose creator has gone
    const B = await h.page('Guest'), C = await h.page('Gone');
    await h.join(C, h.base, 'Gone'); await C.waitForFunction(() => window.getInvite && window.getInvite());
    const dead = await C.evaluate(() => window.getInvite()); await C.close(); await sleep(1500);
    await h.join(B, dead, 'Guest');
    await B.waitForFunction(() => !document.getElementById('notice').hidden, null, { timeout: 20000 });
    assert.match(await B.textContent('#noticeText'), /That jam had ended, so you’re in a new one of your own/);
    const mine = await B.evaluate(() => window.getInvite());
    assert.notEqual(mine, dead, 'your own invite link now');
    await B.waitForSelector('#hostControls:not([hidden])', { state: 'attached', timeout: 10000 });   // and you run the band
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
