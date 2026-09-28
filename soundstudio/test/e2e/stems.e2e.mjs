// End-to-end: the stems band. A stock track plays in step on two devices and
// taking a seat silences that part on both; a prompted track is made by the
// host (stand-in service) and shared with the other player over the room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('stems band: stock track, seats mute parts, prompted track shared', { timeout: 150000 }, async () => {
  const h = await startServers();
  try{
    const A = await h.page('Host', { band: 'stems' }), B = await h.page('Guest', { band: 'stems' });
    await h.join(A, h.base, 'Host');
    await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.recv > 200), null, { timeout: 30000 });
    await A.waitForSelector('#hostControls:not([hidden])');   // the room's creator runs the band
    await A.waitForSelector('#stock-blues-a-92'); await A.click('#stock-blues-a-92');
    await A.waitForFunction(() => /Blues shuffle in A/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
    await A.click('#playBtn');
    await B.waitForFunction(() => window.jamStems.playing(), null, { timeout: 15000 });
    await A.waitForFunction(() => window.jamStems.playing(), null, { timeout: 5000 });
    await sleep(1500);
    const peek = p => p.evaluate(() => ({ zero: window.jamStart.zero, parts: window.jamStems.parts().sort(), drums: window.jamStems.gainOf('drums'), facts: document.getElementById('facts').textContent }));
    let a = await peek(A), b = await peek(B);
    assert.deepEqual(a.parts, ['bass', 'drums', 'guitar', 'piano'], 'the stock track has its four parts');
    assert.deepEqual(b.parts, a.parts, 'the guest loaded the same parts');
    assert.ok(Math.abs(a.zero - b.zero) < 25, `same start on both devices (${(a.zero - b.zero).toFixed(1)} ms apart)`);
    assert.match(a.facts, /Stock track/);
    assert.ok(a.drums > 0.9 && b.drums > 0.9, 'drums playing before anyone takes the seat');
    await B.click('.strip:has-text("Drums") .seat'); await sleep(1200);
    a = await peek(A); b = await peek(B);
    assert.ok(a.drums < 0.05 && b.drums < 0.05, `taking the drums silences the drum part everywhere (${a.drums}, ${b.drums})`);

    // prompted track: wrong code asks for one, right code makes it and the guest gets it over the room
    await A.click('#mode-prompt');
    await A.fill('#prompt', 'Slow funk in E minor, 96 bpm');
    await A.fill('#stemsCode', 'nope'); await A.click('#genBtn');
    await A.waitForFunction(() => /access code/.test(document.getElementById('genStatus').textContent), null, { timeout: 10000 });
    await A.fill('#stemsCode', 'test'); await A.click('#genBtn');
    await A.waitForFunction(() => /track is ready/.test(document.getElementById('genStatus').textContent), null, { timeout: 20000 });
    const id = await A.evaluate(() => window.jamStems.parts().length && document.getElementById('facts').textContent);
    assert.match(id, /Your track/);
    await B.waitForFunction(() => window.jamStems.parts().length === 4 && /Your track/.test(document.getElementById('facts').textContent), null, { timeout: 20000 });
    await B.waitForFunction(() => window.jamStems.playing(), null, { timeout: 10000 });
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
