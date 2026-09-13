import test from 'node:test';
import assert from 'node:assert/strict';
import { weave, analyze, applyLevel, toText, buildIndex, tokenize } from '../src/diglot/weave.js';
import { pluralize, agree, conjugate, article } from '../src/diglot/morph.js';

const at = (text, level, opts = {}) => toText(weave(text, { level, ...opts }).nodes);

test('tokenizer loses nothing', () => {
  const text = 'The old woman — she "waited", didn’t she? Yes.\n\nThen: 42 birds.';
  assert.equal(tokenize(text).map((t) => t.raw).join(''), text);
});

test('a low level weaves only the easiest words', () => {
  const out = at('The woman opened the door of her house.', 10);
  assert.match(out, /mujer/);
  assert.match(out, /puerta/);
  assert.match(out, /^The /); // "the" is band 9, far too hard for level 10
});

test('raising the level never takes Spanish away', () => {
  const text = 'The old woman opened the door of her small house and looked at the sea.';
  const analysis = analyze(text);
  let previous = new Set();
  for (let level = 0; level <= 100; level += 5) {
    const keys = new Set(applyLevel(analysis, { level }).nodes
      .filter((n) => n.kind === 'swap' && n.pos !== 'det').map((n) => n.key));
    for (const key of previous) assert.ok(keys.has(key), `"${key}" vanished at level ${level}`);
    previous = keys;
  }
});

test('nouns keep their number', () => {
  assert.match(at('She read three books.', 30), /libros/);
  assert.match(at('She read one book.', 30), /libro\b/);
});

test('adjectives agree with their noun', () => {
  assert.match(at('The new houses are here.', 40), /nuevas casas/);
  assert.match(at('the small house', 40), /pequeña casa/);
  assert.match(at('The children were happy.', 40), /felices/);
});

test('adjective agreement stops at a clause boundary', () => {
  // "cold" belongs to "water", not to anything after "because"
  assert.match(at('The children were happy because the water was cold.', 40), /agua was fría/);
});

test('determiners agree once articles are on', () => {
  assert.match(at('The house is here.', 60), /^La casa/);
  assert.match(at('The houses are here.', 60), /^Las casas/);
  assert.match(at('The water is cold.', 60), /^El agua/); // feminine, but "el agua"
});

test('verbs are conjugated to fit the sentence', () => {
  assert.match(at('She walks to the city.', 30), /camina/);
  assert.match(at('They walked to the city.', 30), /caminaron/);
  assert.match(at('I want to learn.', 40), /quiero/i);
  assert.match(at('I want to learn.', 40), /aprender/);   // infinitive after "to"
  assert.match(at('He is reading a book.', 40), /leyendo/);
  assert.match(at('The plans of the company changed.', 40), /cambiaron/);
});

test('ambiguous words resolve from context', () => {
  assert.match(at('The man who lives here.', 40), /vive/);   // verb, not "vidas"
  assert.match(at('Their lives changed.', 40), /vidas/);     // noun
});

test('a word that is both noun and verb reads from its subject', () => {
  assert.match(at('Her neighbours thought this was strange.', 80), /pensaron/);  // verb
  assert.match(at('She had a thought.', 80), /pensamiento/);                     // noun
});

test('an inflected verb is not mistaken for the noun it is built from', () => {
  // "worked" must not read as the noun "work", or the subject search stops there
  assert.match(at('The men who worked on the water laughed.', 80), /rieron/);
  assert.match(at('The man who lives here left London.', 80), /salió/);
});

test('a predicate adjective agrees only across a copula', () => {
  assert.match(at('The children were happy.', 60), /felices/);            // across "were"
  assert.match(at('The men laughed a little.', 80), /poco\b/);            // not across "laughed"
});

test('proper nouns are left alone', () => {
  const out = at('Maria and Carlos left London for Madrid.', 100);
  for (const name of ['Maria', 'Carlos', 'London', 'Madrid']) assert.match(out, new RegExp(name));
  assert.match(out, /salieron/); // but the compound subject still makes the verb plural
});

test('phrases beat single words', () => {
  assert.match(at('Of course, this is important.', 30), /Por supuesto/);
});

test('de + el contracts', () => {
  assert.match(at('the history of the world', 100), /del mundo/);
});

test('known words are woven below their level, blocked words never', () => {
  const text = 'The government announced a policy.';
  assert.match(at(text, 5, { known: new Set(['government']) }), /gobierno/);
  assert.doesNotMatch(at(text, 100, { blocked: new Set(['government']) }), /gobierno/);
});

test('stats count what was actually woven', () => {
  const { stats } = weave('The woman opened the door.', 30);
  assert.equal(stats.words, 5);
  assert.ok(stats.swapped >= 2 && stats.swapped <= 5);
  assert.ok(stats.ratio > 0 && stats.ratio <= 1);
});

test('level 0 leaves the text alone', () => {
  const text = 'The woman opened the door of her house.';
  assert.equal(at(text, 0), text);
});

test('morphology basics', () => {
  assert.equal(pluralize('ciudad'), 'ciudades');
  assert.equal(pluralize('luz'), 'luces');
  assert.equal(pluralize('canción'), 'canciones');
  assert.equal(agree('rojo', 'f', true), 'rojas');
  assert.equal(agree('trabajador', 'f'), 'trabajadora');
  assert.equal(conjugate('tener', 'pres1'), 'tengo');
  assert.equal(conjugate('pedir', 'pret3'), 'pidió');
  assert.equal(article('definite', 'f', true), 'las');
});

test('the lexicon is well formed', () => {
  const index = buildIndex();
  assert.ok(index.size > 800, `only ${index.size} entries`);
  for (const entry of index.byKey.values()) {
    assert.ok(entry.es && entry.es.trim() === entry.es, `bad translation for ${entry.key}`);
    assert.match(entry.pos, /^(n|v|adj|adv|prep|conj|pron|num|det|interj|phrase)$/);
    assert.ok(entry.rank >= 0 && entry.rank <= 100);
  }
});
