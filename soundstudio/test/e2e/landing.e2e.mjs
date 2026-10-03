// End-to-end: the landing page at the site root. Start a jam goes to the room,
// a pasted invite opens it, old invite links (/?join=…) still land in the room,
// and the desktop app skips the landing page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers } from './harness.mjs';

const SHOTS = process.env.SHOTS;
test('landing page: start, paste an invite, old links, the app', { timeout: 60000 }, async () => {
  const h = await startServers();
  try{
    const root = h.base.replace(/\/jam\/\?.*$/, '/');
    const A = await h.page('Visitor');
    await A.goto(root);
    assert.match(await A.textContent('h1'), /Jam with anyone/);
    if(SHOTS){ await A.screenshot({ path: SHOTS + '/landing.png', fullPage: true }); await A.setViewportSize({ width: 390, height: 844 }); await A.screenshot({ path: SHOTS + '/landing-phone.png', fullPage: true }); await A.setViewportSize({ width: 1400, height: 900 }); }
    await A.click('.hero .btn-primary'); await A.waitForURL(/\/jam\/$/);
    assert.ok(await A.isVisible('#joinBtn'), 'Start a jam opens the room');
    await A.goto(root); await A.fill('#inviteInput', 'https://air.band/?join=abcdef1234&g=8'); await A.click('#inviteForm button');
    await A.waitForURL(/\/jam\/\?join=abcdef1234/);
    await A.goto(root + '?join=room-from-an-old-link'); await A.waitForURL(/\/jam\/\?join=room-from-an-old-link/);
    const B = await h.page('App'); await B.addInitScript(() => { window.__SS_NATIVE = { port: 1, token: 'x', version: '0.6.2' }; });
    await B.goto(root); await B.waitForURL(/\/jam\/$/);
    assert.deepEqual(h.errors.filter(e => !/^App:/.test(e)), []);
  } finally { await h.close(); }
});
