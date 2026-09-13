import test from 'node:test';
import assert from 'node:assert/strict';
import { weave } from '../src/diglot/weave.js';
import { buildNarration, sentenceText, batchRuns } from '../src/diglot/speech.js';

const narrate = (text, level = 35, opts = {}) =>
  buildNarration(weave(text, { level }).nodes, opts);

test('sentences split on real sentence ends', () => {
  const n = narrate('The woman opened the door. She counted three boats. Was it cold?');
  assert.equal(n.sentences.length, 3);
  assert.match(sentenceText(n.sentences[2]), /\?$/);
});

test('an abbreviation is not a sentence end', () => {
  // the weaver emits one node per word, so the guard has to look across nodes
  const n = narrate('Dr. Ramos waited near the sea. The day was cold.');
  assert.equal(n.sentences.length, 2);
  assert.match(sentenceText(n.sentences[0]), /^Dr\. Ramos/);
});

test('paragraphs are marked so the reader can lay them out', () => {
  const n = narrate('The woman waited.\n\nThe boats came home.');
  assert.equal(n.sentences.length, 2);
  assert.equal(n.sentences[0].paragraphStart, true);
  assert.equal(n.sentences[1].paragraphStart, true);
  assert.ok(n.sentences[1].runs.at(-1).gapAfter >= n.sentences[0].runs.at(-1).gapAfter);
});

test('nothing in the text is lost', () => {
  const text = 'The old woman opened the door of her small house, and looked at the sea.';
  const nodes = weave(text, { level: 40 }).nodes;
  const n = buildNarration(nodes, { echo: 'none' });
  const fromNarration = n.sentences
    .flatMap((s) => s.parts.map((p) => (p.type === 'text' ? p.text : p.node.text))).join('');
  assert.equal(fromNarration.trim(), nodes.map((x) => x.text).join('').trim());
});

test('each Spanish word is its own run, so it can be timed and highlighted', () => {
  const n = narrate('The woman opened the door.', 35, { echo: 'none' });
  const words = n.sentences[0].runs.filter((r) => r.kind === 'word');
  assert.ok(words.length >= 2);
  for (const run of words) {
    assert.equal(run.lang, 'es');
    assert.equal(typeof run.part, 'number');   // points at the span on the page
  }
});

test('the English gloss is spoken once per word, in English', () => {
  const text = 'The woman opened the door. The woman opened the door.';
  const first = narrate(text, 35, { echo: 'first' });
  const always = narrate(text, 35, { echo: 'always' });
  const none = narrate(text, 35, { echo: 'none' });
  const glosses = (n) => n.sentences.flatMap((s) => s.runs.filter((r) => r.kind === 'gloss'));
  assert.equal(none.stats.glosses, 0);
  assert.ok(glosses(first).length > 0);
  assert.equal(glosses(always).length, glosses(first).length * 2); // same sentence twice
  for (const gloss of glosses(first)) assert.equal(gloss.lang, 'en');
});

test('articles are not glossed — "la (the)" is noise', () => {
  const n = narrate('The house is here.', 60, { echo: 'always' });
  const glossed = n.sentences[0].runs.filter((r) => r.kind === 'gloss').map((r) => r.text.toLowerCase());
  assert.ok(!glossed.includes('the'));
});

test('a shadowing gap goes after content words, not articles', () => {
  const n = narrate('The woman waited.', 40, { echo: 'none', wordGap: 700 });
  const words = n.sentences[0].runs.filter((r) => r.kind === 'word');
  const noun = words.find((r) => /mujer/i.test(r.text));
  assert.ok(noun, 'expected "mujer" to be woven');
  assert.equal(noun.gapAfter, 700);
  const article = words.find((r) => /^(el|la|los|las)$/i.test(r.text));
  if (article) assert.equal(article.gapAfter, 0, 'no gap between an article and its noun');
});

test('batching joins same-language runs with spaces and keeps order', () => {
  const n = narrate('The old woman opened the door of her small house.', 40, { echo: 'none' });
  const batches = batchRuns(n.sentences);
  assert.ok(batches.length < n.sentences[0].runs.length, 'batching should reduce requests');
  for (const batch of batches) {
    assert.match(batch.lang, /^(es|en)$/);
    assert.ok(batch.text.length);
    assert.doesNotMatch(batch.text, /\w\w{0,40}[a-z][A-ZÁÉÍÓÚÑ]/, `words glued together: ${batch.text}`);
  }
  const spoken = batches.map((b) => b.text).join(' ');
  assert.match(spoken, /vieja/);
  assert.match(spoken, /casa/);
});

test('turning the echo off means far fewer requests', () => {
  const text = 'The old woman opened the door of her small house and looked at the sea.';
  const withEcho = batchRuns(narrate(text, 40, { echo: 'first' }).sentences).length;
  const without = batchRuns(narrate(text, 40, { echo: 'none' }).sentences).length;
  assert.ok(without < withEcho);
});
