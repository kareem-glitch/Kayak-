import test from 'node:test';
import assert from 'node:assert/strict';
import { zip, unzip, buildEpub } from '../src/diglot/epub.js';
import { cleanText, splitIntoSections, wordCount, guessTitle } from '../src/diglot/ingest.js';
import { entriesToBands } from '../src/diglot/llm.js';
import { buildIndex } from '../src/diglot/weave.js';
import { BANDS } from '../src/diglot/lexicon.js';

test('zip round-trips through unzip', async () => {
  const bytes = zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: 'wörld ünicode' }]);
  const files = await unzip(bytes.buffer);
  assert.equal(new TextDecoder().decode(files.get('a.txt')), 'hello');
  assert.equal(new TextDecoder().decode(files.get('dir/b.txt')), 'wörld ünicode');
});

test('the EPUB has the parts a reader needs', async () => {
  const bytes = buildEpub({
    title: 'Book', author: 'Nobody', level: 40,
    chapters: [{ title: 'One', html: '<p>Hola</p>' }, { title: 'Two', html: '<p>Adiós</p>' }],
    vocab: [{ es: 'casa', en: 'house' }],
  });
  const files = await unzip(bytes.buffer);
  const text = (name) => new TextDecoder().decode(files.get(name));
  assert.equal(text('mimetype'), 'application/epub+zip');           // and it must be first
  assert.equal([...files.keys()][0], 'mimetype');
  assert.match(text('META-INF/container.xml'), /OEBPS\/content\.opf/);
  const opf = text('OEBPS/content.opf');
  assert.match(opf, /<dc:title>Book<\/dc:title>/);
  assert.match(opf, /properties="nav"/);
  for (const id of ['ch1', 'ch2', 'vocab']) {
    assert.match(opf, new RegExp(`<itemref idref="${id}"/>`));
    assert.ok(files.has(`OEBPS/${id}.xhtml`));
  }
  assert.match(text('OEBPS/vocab.xhtml'), /casa[\s\S]*house/);
});

test('EPUB output escapes markup in the text', async () => {
  const bytes = buildEpub({ title: 'A & B <tag>', chapters: [{ title: 'x', html: '<p>ok</p>' }] });
  const files = await unzip(bytes.buffer);
  assert.match(new TextDecoder().decode(files.get('OEBPS/content.opf')), /A &amp; B &lt;tag&gt;/);
});

test('pasted text is tidied without losing paragraphs', () => {
  const messy = 'One   line\r\n\r\n\r\nSecond    paragraph here.';
  assert.equal(cleanText(messy), 'One line\n\nSecond paragraph here.');
});

test('long texts split at paragraph boundaries', () => {
  const text = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(199) + 'end').join('\n\n');
  const sections = splitIntoSections(text, 500);
  assert.ok(sections.length >= 3, `only ${sections.length} sections`);
  assert.equal(sections.join('\n\n'), text);           // nothing lost
  for (const s of sections) assert.ok(s.startsWith('Paragraph') && s.endsWith('end'));
});

test('word counting and titles', () => {
  assert.equal(wordCount("it's a dog's life — really"), 5);
  assert.equal(guessTitle('# A Heading\n\nBody text'), 'A Heading');
  assert.equal(guessTitle('', 'Untitled'), 'Untitled');
});

test("Claude's entries merge into the bands at the right difficulty", () => {
  const extra = entriesToBands([
    { en: 'harbour', es: 'puerto', pos: 'n', gender: 'm', tier: 3 },
    { en: 'set sail', es: 'zarpar', pos: 'v', gender: 'm', tier: 8 },
  ]);
  assert.deepEqual(extra[2], ['harbour|puerto|n|m']);
  assert.deepEqual(extra[7], ['set sail|zarpar|v']);

  const merged = BANDS.map((band, i) => [...band, ...(extra[i] || [])]);
  const index = buildIndex(merged);
  assert.equal(index.byKey.get('harbour').es, 'puerto');
  assert.equal(index.maxPhrase, 4);
  assert.ok(index.byKey.get('harbour').rank < index.byKey.get('set sail').rank);
});
