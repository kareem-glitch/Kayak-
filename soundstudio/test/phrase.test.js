// The AI soloist's ear and brain: hears pitches, turns them into notes, and
// answers in the song's key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pitchOf, midiOf, notesFrom, scaleFor, snap, answer } from '../app/band/phrase.js';

const guitar = (hz, n, rate) => Float32Array.from({ length: n }, (_, i) => { const t = i / rate; return 0.4 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t) + 0.12 * Math.sin(6 * Math.PI * hz * t); });

test('hears guitar notes across the neck (with harmonics), and silence as silence', () => {
  for(const [hz, midi] of [[82.41, 40], [110, 45], [196, 55], [329.63, 64], [659.25, 76]]) assert.equal(midiOf(pitchOf(guitar(hz, 1024, 12000), 12000)), midi, `${hz} Hz`);
  assert.equal(pitchOf(new Float32Array(1024), 12000), 0);
});

test('readings become notes at pitch changes', () => {
  const r = [{ t: 0, midi: 64 }, { t: 0.4, midi: 64 }, { t: 1, midi: 67 }, { t: 1.5, midi: 67 }, { t: 2, midi: 0 }, { t: 4, midi: 67 }];
  assert.deepEqual(notesFrom(r).map(n => [n.pos, n.midi]), [[0, 64], [1, 67], [4, 67]]);
});

test('keys: minor pentatonic + blue note for minor/blues, major pentatonic for major', () => {
  assert.deepEqual(scaleFor('E minor'), { root: 4, steps: [0, 3, 5, 6, 7, 10] });
  assert.deepEqual(scaleFor('A', 'blues'), { root: 9, steps: [0, 3, 5, 6, 7, 10] });
  assert.deepEqual(scaleFor('F major'), { root: 5, steps: [0, 2, 4, 7, 9] });
  assert.equal(snap(61, scaleFor('E minor')), 62, 'C# snaps to D in E minor pentatonic');
});

test('answers: in key, on the grid, ends on the root, same answer on every device', () => {
  const scale = scaleFor('E minor'), inKey = m => scale.steps.includes(((m - scale.root) % 12 + 12) % 12);
  for(const bars of [4, 8]){
    const a = answer({ bars, scale, seed: 7 });
    assert.ok(a.length >= bars * 3, `a real phrase (${a.length} notes in ${bars} bars)`);
    assert.ok(a.every(n => inKey(n.midi) && Number.isInteger(n.pos) && n.pos < bars * 16 && n.len >= 1), 'every note in key, on a 16th, inside the turn');
    assert.equal(((a[a.length - 1].midi - scale.root) % 12 + 12) % 12, 0, 'resolves to the root');
    assert.deepEqual(answer({ bars, scale, seed: 7 }), a, 'deterministic');
  }
  // call and response: your rhythm comes back, your melody's direction flips
  const call = [{ pos: 16, midi: 64 }, { pos: 18, midi: 67 }, { pos: 20, midi: 69 }, { pos: 22, midi: 71 }, { pos: 26, midi: 74 }];
  const resp = answer({ heard: call, bars: 4, scale, seed: 1 });
  assert.deepEqual(resp.slice(0, 5).map(n => n.pos), [0, 2, 4, 6, 10], 'keeps your rhythm');
  assert.ok(resp[4].midi < resp[0].midi, `you went up, it answers going down (${resp.slice(0, 5).map(n => n.midi)})`);
});
