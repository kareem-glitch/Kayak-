// End-to-end: the pocket synth. On a phone with no instrument you switch on
// the synth: pads in the song's key appear, your mic goes quiet, and the
// others hear what you play on the pads (and nothing when you stop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('pocket synth: pads in the key, heard by the room, mic muted', { timeout: 90000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host', { band: 'stems' }), B = await h.page('Walker');
    await B.setViewportSize({ width: 390, height: 844 });
    await h.join(A, h.base, 'Host');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Walker');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await A.waitForFunction(() => /Slow funk/.test(document.getElementById('arrTitle').textContent), null, { timeout: 20000 });
    const walker = () => B.evaluate(() => window.jamPeers.keys().next().value).then(() => A.evaluate(() => { const id = [...window.jamPeers.keys()][0]; let m = 0; return new Promise(r => { const t = setInterval(() => { m = Math.max(m, window.jamLevel(id)); }, 20); setTimeout(() => { clearInterval(t); r(m); }, 800); }); }));

    await B.click('#synthBtn');
    await B.waitForSelector('#synthPanel:not([hidden])');
    const read = () => B.$$eval('.key', els => els.map(e => ({ nm: e.querySelector('.nm').textContent, in: e.classList.contains('in'), root: e.classList.contains('root') })));
    let keys = await read();
    assert.deepEqual(keys.map(k => k.nm), ['E', 'G', 'A', 'Bb', 'B', 'D', 'E'], 'on a phone: one row of the E minor blues scale, root to root');
    assert.deepEqual(keys.filter(k => k.root).length, 2, 'the roots stand out');
    const cube = await B.locator('.key').first().boundingBox();
    assert.ok(cube.width >= 40 && Math.abs(cube.width - cube.height) < 2, `square keys big enough for a thumb (${Math.round(cube.width)} x ${Math.round(cube.height)})`);
    await B.click('[data-scale="all"]');
    keys = await read();
    assert.equal(keys.length, 13, 'All: every note, C to C, in one row');
    assert.deepEqual(keys.filter(k => k.in).map(k => k.nm), ['D', 'E', 'G', 'A', 'Bb', 'B'], 'with the scale marked');
    await B.click('[data-scale="key"]');
    await B.click('[data-oct="1"]'); assert.equal(await B.textContent('.synth-oct'), 'C5', 'octave up'); await B.click('[data-oct="-1"]');
    assert.equal(await B.isDisabled('#micBtn'), true, 'the mic is off while the synth is on');
    await sleep(1000);
    const quiet = await walker();
    // hold a pad (a real tap on the screen)
    const box = await B.locator('.key.root').first().boundingBox();
    await B.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await B.mouse.down();
    await sleep(400);
    assert.ok(await B.evaluate(() => document.querySelector('.key.on') !== null), 'the key lights up');
    const loud = await walker();
    assert.match(await B.textContent('.synth-lat'), /^\d+ ms$/, 'the delay from finger to ears is shown');
    await B.mouse.up(); await sleep(600);
    const after = await walker();
    assert.ok(quiet < 0.02, `nothing sent before you play: the mic is muted (${quiet})`);
    assert.ok(loud > 0.1, `the host hears the synth (${loud})`);
    assert.ok(after < 0.02, `and silence after you let go (${after})`);
    // the delay test: with no speaker -> mic path (a test machine) it says so; the timing itself is sample-exact
    await B.click('#synthTest');
    await B.waitForFunction(() => !document.getElementById('synthTest').disabled, null, { timeout: 15000 });
    assert.match(await B.textContent('#synthNote'), /Couldn’t hear the clicks|round trip/, 'the test reports back');
    const rt = await B.evaluate(() => window.jamRoundTrip(3, 50));
    assert.ok(rt >= 49 && rt <= 52, `a 50 ms speaker-to-mic path measures as 50 ms (${rt})`);
    await B.click('#synthBtn');
    assert.equal(await B.isHidden('#synthPanel'), true, 'the keyboard goes away');
    assert.equal(await B.isDisabled('#micBtn'), false, 'the mic comes back');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
