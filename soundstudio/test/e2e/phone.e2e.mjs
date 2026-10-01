// End-to-end on an emulated phone (touch, mobile layout): fast taps on the on-screen
// synth each play a note and never zoom the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServers, sleep } from './harness.mjs';
test('phone: fast taps on the synth play notes and never zoom', { timeout: 90000 }, async () => {
  const h = await startServers();
  const b = await chromium.launch({ args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try{
    const ctx = await b.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, permissions: ['camera', 'microphone'] });
    const A = await ctx.newPage(); await A.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await A.addInitScript(() => { localStorage.setItem('ss.part', 'none'); localStorage.setItem('ss.cam', '0'); });
    await A.goto(h.base); await A.fill('#nameInput', 'Kareem'); await A.tap('#joinBtn');
    await A.waitForFunction(() => window.getInvite && window.getInvite(), null, { timeout: 45000 });
    await A.tap('#synthBtn'); await A.waitForSelector('#synthPanel:not([hidden])');
    await A.evaluate(() => { window.__notes = 0; new MutationObserver(ms => ms.forEach(m => { if(m.target.classList.contains('on') && !(m.oldValue || '').includes(' on')) window.__notes++; })).observe(document.getElementById('synthPanel'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true }); });
    for(let i = 0; i < 6; i++){ await A.tap('.key >> nth=2'); await sleep(120); }   // fast repeated taps: what iPhone Safari zooms on
    const scale = await A.evaluate(() => visualViewport.scale);
    assert.equal(scale, 1, 'not zoomed after fast taps');
    const notes = await A.evaluate(() => window.__notes);
    assert.ok(notes >= 5, `each tap plays a note (${notes} of 6)`);
  } finally { await b.close(); await h.close(); }
});
