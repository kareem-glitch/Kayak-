// Pixel-art tone icons: every sprite is a clean 16x16 grid using only defined
// colours, has a pilot light to blink, and there's one for every tone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRITES } from '../app/tone-icons.js';
import { TONES } from '../app/audio/tone.js';

test('tone icons: one per tone, 16x16, known colours, a pilot light', () => {
  assert.deepEqual(Object.keys(SPRITES).sort(), TONES.map(t => t.id).sort());
  const base = 'kwWsSgGbBy';
  for(const [id, sp] of Object.entries(SPRITES)){
    assert.equal(sp.rows.length, 16, `${id}: 16 rows`);
    sp.rows.forEach((r, y) => assert.equal(r.length, 16, `${id} row ${y}: 16 pixels ("${r}")`));
    const used = new Set(sp.rows.join('').replace(/\./g, ''));
    for(const ch of used) assert.ok(base.includes(ch) || ch in sp.pal, `${id}: colour "${ch}" is defined`);
    assert.ok(used.has('L'), `${id}: has a pilot light`);
  }
});
