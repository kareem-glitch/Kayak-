// End-to-end: tap the band display to transpose (pitch only, drums untouched)
// and change the tempo of a recorded stock track; the guest follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('band display: transpose and tempo, recorded stems', { timeout: 150000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host', { band: 'stems' }), B = await h.page('Guest', { band: 'stems' });
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForSelector('#hostControls:not([hidden])', { state: 'attached' });
    await h.drawer(A, 'band'); await A.waitForSelector('#stock-funk-em-96'); await A.click('#stock-funk-em-96');
    await A.waitForFunction(() => window.jamState.arr && window.jamState.arr.engine === 'stems' && window.jamStems.ready(window.jamState.arr.pack.id), null, { timeout: 30000 });
    const before = await A.evaluate(() => { const b = window.jamStems.debug(); return { bass: b.bass, drums: b.drums }; });
    await A.click('#bandTile'); assert.ok(await A.isVisible('#lcdPop'));
    assert.match(await A.textContent('#popKey'), /^Em$/);
    await A.click('#lcdPop [data-tr="1"]'); await A.click('#lcdPop [data-tr="1"]');
    assert.match(await A.textContent('#popKey'), /^F#m \(\+2\)$/);
    await A.waitForFunction(() => window.jamStems.debug().semis === 2, null, { timeout: 30000 });
    const after = await A.evaluate(() => window.jamStems.debug());
    assert.equal(after.lengths.bass, before.bass.len, 'same length: transposing keeps the tempo');
    assert.ok(Math.abs(after.zc.bass / before.bass.zc - Math.pow(2, 2 / 12)) < 0.06, `bass is higher by two semitones (${(after.zc.bass / before.bass.zc).toFixed(3)})`);
    assert.equal(after.zc.drums, before.drums.zc, 'drums untouched');
    assert.equal(await A.evaluate(() => window.jamState.arr.key), 'F# minor');
    await B.waitForFunction(() => window.jamStems.debug && window.jamStems.debug() && window.jamStems.debug().semis === 2, null, { timeout: 30000 });   // the guest follows
    // tempo: 96 -> 100, parts get shorter in proportion, pitch unchanged
    for(let i = 0; i < 4; i++) await A.click('#lcdPop [data-bpm="1"]');
    await A.waitForFunction(() => window.jamStems.debug().bpm === 100, null, { timeout: 30000 });
    const fast = await A.evaluate(() => window.jamStems.debug());
    assert.ok(Math.abs(fast.lengths.drums / before.drums.len - 96 / 100) < 0.002, 'drums 96/100 as long');
    assert.ok(Math.abs(fast.zc.bass / fast.lengths.bass * before.bass.len / before.bass.zc - Math.pow(2, 2 / 12)) < 0.06, 'bass pitch still +2 at the new tempo');
    assert.ok(await B.isDisabled('#lcdPop [data-tr="1"]').catch(() => true), 'only the host changes it');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
