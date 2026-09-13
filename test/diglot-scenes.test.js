import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, sceneToText, sceneGroups, allPhrases } from '../src/diglot/scenes.js';
import { weave, toText } from '../src/diglot/weave.js';
import { buildNarration, buildDrill, sentenceText } from '../src/diglot/speech.js';
import { buildIndex } from '../src/diglot/weave.js';
import { PHRASE_BANDS } from '../src/diglot/phrasebook.js';

test('the scenes are well formed', () => {
  const ids = new Set();
  for (const scene of SCENES) {
    assert.ok(scene.id && !ids.has(scene.id), `duplicate or missing id: ${scene.id}`);
    ids.add(scene.id);
    assert.ok(scene.title && scene.group && scene.blurb);
    assert.ok(scene.turns.length >= 8, `${scene.id} is too short`);
    assert.ok(scene.phrases.length >= 6, `${scene.id} needs more phrases`);
    for (const [speaker, line] of scene.turns) {
      assert.ok(speaker && !speaker.includes(':'), `bad speaker in ${scene.id}`);
      assert.ok(line.trim().length > 1, `empty line in ${scene.id}`);
    }
    for (const phrase of scene.phrases) {
      assert.ok(phrase.en && phrase.es, `incomplete phrase in ${scene.id}`);
      assert.notEqual(phrase.en, phrase.es);
    }
  }
  assert.ok(sceneGroups().length >= 5);
  assert.ok(allPhrases().length > 70);
});

test('phrases are deduplicated across scenes', () => {
  const all = allPhrases().map((p) => p.es.toLowerCase());
  assert.equal(all.length, new Set(all).size);
});

test('a scene becomes speaker-labelled text', () => {
  const text = sceneToText(SCENES[0]);
  assert.match(text, /^You: /);
  assert.equal(text.split('\n\n').length, SCENES[0].turns.length);
});

test('speaker labels are never translated', () => {
  const woven = toText(weave(sceneToText(SCENES.find((s) => s.id === 'restaurant')), { level: 100 }).nodes);
  assert.match(woven, /^You: /m);
  assert.match(woven, /^Waiter: /m);
  assert.doesNotMatch(woven, /^Tú:/m);           // "You" is a label here, not the pronoun
  assert.match(woven, /por favor/);              // but the dialogue itself is woven
});

test('the narration knows who is speaking, and does not read the label out', () => {
  const scene = SCENES.find((s) => s.id === 'bakery');
  const narration = buildNarration(weave(sceneToText(scene), { level: 40 }).nodes, { echo: 'none' });
  const speakers = [...new Set(narration.sentences.map((s) => s.speaker))];
  assert.deepEqual(speakers.sort(), ['Baker', 'You']);
  for (const sentence of narration.sentences) {
    assert.doesNotMatch(sentenceText(sentence), /^(You|Baker):/);
    for (const run of sentence.runs) assert.equal(run.speaker, sentence.speaker);
  }
});

test('situational phrases beat a word-by-word swap', () => {
  const at = (text, level) => toText(weave(text, { level }).nodes);
  assert.match(at('How much is it?', 30), /Cuánto cuesta/i);
  assert.match(at('The bill, please.', 40), /La cuenta, por favor/i);
  assert.match(at('Is there a table?', 30), /Hay/i);          // existential, not "allí"
  assert.match(at('Where is the station?', 40), /Dónde está/i);
});

test('the phrasebook merges into the lexicon without breaking it', () => {
  const index = buildIndex();
  assert.ok(index.size > 1000);
  for (const band of PHRASE_BANDS) {
    for (const entry of band) {
      const parts = entry.split('|');
      assert.equal(parts.length >= 3, true, `malformed: ${entry}`);
      assert.ok(parts[1].trim() === parts[1] && parts[1].length, `bad translation: ${entry}`);
    }
  }
});

test('a drill runs English, gap, Spanish', () => {
  const phrases = [{ en: 'The bill, please.', es: 'La cuenta, por favor.' }];
  const [sentence] = buildDrill(phrases, { gap: 3000 });
  assert.deepEqual(sentence.runs.map((r) => [r.lang, r.kind]), [['en', 'prompt'], ['es', 'answer']]);
  assert.equal(sentence.runs[0].gapAfter, 3000);
  assert.equal(sentence.parts.map((p) => p.type).join(','), 'prompt,answer');
});

test('a drill can say the answer twice', () => {
  const [sentence] = buildDrill([{ en: 'a', es: 'b' }], { repeat: true });
  assert.equal(sentence.runs.filter((r) => r.kind === 'answer').length, 2);
});
