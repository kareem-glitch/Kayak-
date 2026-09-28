// End-to-end: BARS on your own. Pick BARS 4 on the start screen, start a room
// (you run the band straight away), take the guitar seat, press play: you
// trade 4s with the AI band. On your turn the AI guitar drops out; on the
// band's turn it covers for you and another part (keys) steps up front.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('BARS solo: you trade with the AI band; your seat drops out only on your turn', { timeout: 120000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Solo', { band: 'stems', game: 'free' });
    await A.goto(h.base);
    await A.click('[data-pick="4"]');
    assert.match(await A.textContent('#pickNote'), /Alone\? You trade with the AI band/);
    await A.fill('#nameInput', 'Solo'); await A.click('#joinBtn');
    await A.waitForSelector('#hostControls:not([hidden])');   // started the room: running the band
    assert.equal(await A.getAttribute('[data-game="4"]', 'aria-checked'), 'true', 'the room starts in BARS 4');
    assert.match(await A.evaluate(() => window.getInvite()), /&g=4/, 'the invite says which game');
    await A.waitForFunction(() => /Slow funk/.test(document.getElementById('arrTitle').textContent), null, { timeout: 20000 });
    await A.click('[data-seat="guitar"]');
    await A.click('#playBtn');
    await A.waitForFunction(() => window.jamStems.playing(), null, { timeout: 15000 });

    const t0 = await A.evaluate(() => window.jamStart.base), turn = 4 * 4 * 60000 / 96;   // 4 bars at 96 bpm
    const peek = () => A.evaluate(() => ({ line: document.getElementById('turnLine').textContent, bandGlow: document.getElementById('bandTile').classList.contains('onmic'),
      guitar: window.jamStems.gainOf('guitar'), piano: window.jamStems.gainOf('piano'), drums: window.jamStems.gainOf('drums') }));
    const at = async k => { const w = t0 + (k + 0.6) * turn - await A.evaluate(() => performance.timeOrigin + performance.now()); if(w > 0) await sleep(w); return peek(); };
    const mine = await at(0), band = await at(1);
    assert.match(mine.line, /Your 4 bars · next: The band/);
    assert.ok(mine.guitar < 0.05, `your turn: the AI guitar is out (${mine.guitar})`);
    assert.ok(mine.drums > 0.9, 'the rest of the band keeps playing');
    assert.match(band.line, /The band is on · next: you/);
    assert.ok(band.bandGlow, 'the band tile glows on its turn');
    assert.ok(band.guitar > 0.5, `band's turn: the AI guitar covers for you (${band.guitar})`);
    assert.ok(band.piano > 1.5, `band's turn: the keys step up front (${band.piano})`);
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
