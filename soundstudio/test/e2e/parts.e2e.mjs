// End-to-end: any number of people can play the same part. Three guitarists:
// each gets their own tile labelled Guitar, the AI guitar steps out (and stays
// out while any of them is on it), and one leaving doesn't pull the others off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('three guitarists: all on guitar, AI guitar out, the rest of the band stays', { timeout: 120000 }, async () => {
  const h = await startServers();
  try{
    const [A, B, C] = await Promise.all(['Ana', 'Ben', 'Cat'].map(n => h.page(n, { band: 'stems', game: '8' })));
    for(const p of [A, B, C]) await p.addInitScript(() => localStorage.setItem('ss.part', 'guitar'));
    await h.join(A, h.base, 'Ana');
    await A.waitForFunction(() => /Slow funk/.test(document.getElementById('arrTitle').textContent), null, { timeout: 20000 });
    const url = await A.evaluate(() => location.href);
    await h.join(B, url, 'Ben'); await h.join(C, url, 'Cat');
    const tiles = p => p.evaluate(() => [...document.querySelectorAll('.spot')].map(s => s.querySelector('.who').textContent + '/' + (s.querySelector('.inst').textContent || s.querySelector('.role').textContent)).sort());
    await A.waitForFunction(() => document.querySelectorAll('.spot:not(.ai)').length === 3 && [...document.querySelectorAll('.spot:not(.ai) .inst')].every(e => e.textContent === 'Guitar'), null, { timeout: 30000 });
    assert.deepEqual(await tiles(A), ['Ana/Guitar', 'Bass/AI', 'Ben/Guitar', 'Cat/Guitar', 'Drums/AI', 'Keys/AI'], 'three guitarists and the AI rhythm section, no AI guitar');
    await B.waitForFunction(() => document.querySelectorAll('.spot:not(.ai) .inst').length === 3, null, { timeout: 10000 });
    assert.deepEqual(await tiles(B), await tiles(A), 'everyone sees the same band');
    await A.click('#playBtn');
    await A.waitForFunction(() => window.jamStems.playing(), null, { timeout: 15000 }); await sleep(1500);
    assert.ok(await A.evaluate(() => window.jamStems.gainOf('guitar')) < 0.05, 'free jam: the AI guitar is out while anyone plays guitar');
    assert.ok(await A.evaluate(() => window.jamStems.gainOf('drums')) > 0.9, 'the drums play on');
    // Ben leaves: Ana and Cat are still on guitar
    await B.close({ runBeforeUnload: true });
    await A.waitForFunction(() => document.querySelectorAll('.spot:not(.ai)').length === 2, null, { timeout: 60000 });   // a closed browser takes a while to count as gone
    assert.deepEqual((await tiles(A)).filter(t => !/AI/.test(t)), ['Ana/Guitar', 'Cat/Guitar'], 'the other two keep playing guitar');
    await sleep(500);
    assert.ok(await A.evaluate(() => window.jamStems.gainOf('guitar')) < 0.05, 'and the AI guitar stays out');
    assert.deepEqual(h.errors, [], 'no page errors');
  } finally { await h.close(); }
});
