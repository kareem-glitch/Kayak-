// End-to-end: pick your player on the start screen (arcade style): one of four
// characters, or your camera. The others see your character, with its colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers } from './harness.mjs';

const SHOTS = process.env.SHOTS;   // a folder to save screenshots in, when looking at the design
// Is any pixel of `hex` in the sprite on the tile named `name`?
const hasColour = (p, name, hex) => p.evaluate(([name, hex]) => {
  const t = [...document.querySelectorAll('.tile')].find(t => t.querySelector('.tname').textContent === name), cv = t && t.querySelector('canvas.sprite');
  if(!cv) return false;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for(let i = 0; i < d.length; i += 4) if(d[i] === r && d[i + 1] === g && d[i + 2] === b) return true;
  return false;
}, [name, hex]);

test('pick a player: the room sees your character, or your camera', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    await A.goto(h.base);
    assert.equal(await A.locator('#lookPick button').count(), 5, 'four players and the camera');
    assert.equal(await A.getAttribute('[data-look="cam"]', 'aria-checked'), 'true', 'the camera, as picked last time');
    await A.click('[data-look="1"]');
    assert.equal(await A.getAttribute('[data-look="1"]', 'aria-checked'), 'true', 'Juno picked');
    if(SHOTS) await A.screenshot({ path: SHOTS + '/players-pick.png' });
    await A.fill('#nameInput', 'Host'); await A.click('#joinBtn');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await B.waitForFunction(() => document.querySelectorAll('.tile.avatar').length === 1, null, { timeout: 30000 });
    assert.equal(await A.getAttribute('#avatarBtn', 'aria-label'), 'Juno', 'your player is on the character button');
    await B.waitForFunction(() => document.querySelector('.tile.avatar canvas.sprite'), null, { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    assert.ok(await hasColour(B, 'Host', '#7b4fd6'), 'the guest sees Juno (purple hair)');
    assert.ok(!await hasColour(B, 'Host', '#d8322a'), '…not Blaze');
    if(SHOTS) await B.screenshot({ path: SHOTS + '/players-room.png' });
    // only who's really there stands in the circle: no band yet, so just the two of them
    const spots = () => B.evaluate(() => [...document.querySelectorAll('.spot')].map(sp => sp.querySelector('.who').textContent + (sp.classList.contains('muted') ? ' (muted)' : '')));
    assert.ok((await spots()).includes('Drums'), 'the band is loaded: its parts stand there too');
    await h.drawer(A, 'band');
    await A.$$eval('#strips input[type=range]', rs => rs.forEach(r => { r.value = -30; r.dispatchEvent(new Event('input', { bubbles: true })); }));   // the host turns every part off
    await B.waitForFunction(() => document.querySelectorAll('.spot').length === 2, null, { timeout: 5000 });
    assert.deepEqual((await spots()).sort(), ['Guest', 'Host'], 'band parts turned off: just the two players, nobody else');
    await h.drawer(A, 'band'); await A.click('[data-drawer-tab="band"]');   // close the drawer
    await A.click('#micBtn');
    await B.waitForFunction(() => [...document.querySelectorAll('.spot.muted .who')].some(e => e.textContent === 'Host'), null, { timeout: 5000 });
    assert.deepEqual((await spots()).sort(), ['Guest', 'Host (muted)'], 'muting greys you out for the others');
    await A.click('#micBtn');
    // back to the camera in the room
    await A.click('#avatarBtn');
    await B.waitForFunction(() => !document.querySelector('.tile.avatar'), null, { timeout: 5000 });
    assert.equal(await A.evaluate(() => localStorage.getItem('ss.look')), 'cam', 'remembered for next time');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
