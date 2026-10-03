// End-to-end: people are their camera, or a person icon with it off (picked on
// the start screen, toggled in the room); the pixel characters are the AI band's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers } from './harness.mjs';

const SHOTS = process.env.SHOTS;   // a folder to save screenshots in, when looking at the design
test('camera on/off: the room sees your camera or a person icon; characters are the AI band', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    await A.goto(h.base);
    assert.equal(await A.getAttribute('[data-cam="1"]', 'aria-checked'), 'true', 'camera on by default');
    await A.click('[data-cam="0"]');   // join with the camera off
    await A.fill('#nameInput', 'Host'); await A.click('#joinBtn');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    const iconFor = (p, name) => p.evaluate(name => { const t = [...document.querySelectorAll('.tile')].find(t => t.dataset.name === name); return t && t.classList.contains('nocam') && getComputedStyle(t.querySelector('.person')).display !== 'none'; }, name);
    await B.waitForFunction(() => [...document.querySelectorAll('.tile.nocam')].some(t => t.dataset.name === 'Host'), null, { timeout: 30000 });
    assert.ok(await iconFor(B, 'Host'), 'the guest sees a person icon for the host (camera off)');
    assert.ok(!await iconFor(B, 'Guest'), '... and their own camera');
    assert.equal(await B.locator('.tile svg.char').count(), 0, 'no characters for people');
    assert.equal(await A.getAttribute('#camToggle', 'aria-pressed'), 'false');
    if(SHOTS){ await B.waitForTimeout(1500); await B.screenshot({ path: SHOTS + '/players-room.png' }); await A.screenshot({ path: SHOTS + '/players-host.png' }); }
    await A.click('#camToggle');   // camera back on in the room
    await B.waitForFunction(() => !document.querySelector('.tile.nocam'), null, { timeout: 5000 });
    assert.equal(await A.evaluate(() => localStorage.getItem('ss.cam')), '1', 'remembered for next time');
    // only who's really there stands in the circle: no band yet, so just the two of them
    const spots = () => B.evaluate(() => [...document.querySelectorAll('.spot')].map(sp => sp.querySelector('.who').textContent + (sp.classList.contains('muted') ? ' (muted)' : '')));
    assert.ok((await spots()).includes('Drums'), 'the band is loaded: its parts stand there too');
    await B.waitForFunction(() => document.querySelector('.spot.ai svg.char use'), null, { timeout: 5000 });   // the AI players are characters (Moss, Juno, Blaze, Dex)
    // tap an AI player to mute it, just for you
    await B.click('.spot.ai[data-seat="drums"]');
    assert.ok((await spots()).includes('Drums (muted)'), 'tapping the AI drummer mutes it for the guest');
    assert.ok(!(await A.evaluate(() => document.querySelector('.spot.ai[data-seat="drums"]').classList.contains('muted'))), '…not for the host');
    await B.click('.spot.ai[data-seat="drums"]');
    assert.ok((await spots()).includes('Drums'), 'tap again: back');
    // your own mix: a volume slider for each other player
    await h.drawer(B, 'audio');
    await B.waitForSelector('#mixPlayers [aria-label="Host volume"]', { timeout: 5000 });
    await h.drawer(B, 'audio'); await B.click('[data-drawer-tab="audio"]');
    await h.drawer(A, 'band');
    await A.$$eval('#strips input[type=range]', rs => rs.forEach(r => { r.value = -30; r.dispatchEvent(new Event('input', { bubbles: true })); }));   // the host turns every part off
    await B.waitForFunction(() => document.querySelectorAll('.spot').length === 2, null, { timeout: 5000 });
    assert.deepEqual((await spots()).sort(), ['Guest', 'Host'], 'band parts turned off: just the two players, nobody else');
    await h.drawer(A, 'band'); await A.click('[data-drawer-tab="band"]');   // close the drawer
    await A.click('#micBtn');
    await B.waitForFunction(() => [...document.querySelectorAll('.spot.muted .who')].some(e => e.textContent === 'Host'), null, { timeout: 5000 });
    assert.deepEqual((await spots()).sort(), ['Guest', 'Host (muted)'], 'muting greys you out for the others');
    await A.click('#micBtn');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
