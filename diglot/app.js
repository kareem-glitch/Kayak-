// Diglot — the browser side. Nothing here talks to a server except the page
// fetcher and (only if you supply a key) the Anthropic API.

import { analyze, applyLevel, buildIndex, DEFAULT_INDEX } from '../src/diglot/weave.js';
import { buildNarration, buildDrill, NARRATION_DEFAULTS } from '../src/diglot/speech.js';
import { SCENES, sceneToText, sceneGroups, allPhrases } from '../src/diglot/scenes.js';
import { PROVIDERS, listVoices, renderAudio, estimate as estimateAudio } from '../src/diglot/tts.js';
import { BANDS } from '../src/diglot/lexicon.js';
import { fetchArticle, cleanText, splitIntoSections, wordCount, guessTitle } from '../src/diglot/ingest.js';
import { readEpub, buildEpub } from '../src/diglot/epub.js';
import { alignDocument, writeArticle, writeScene, testKey, entriesToBands, MODELS } from '../src/diglot/llm.js';

// ── storage ─────────────────────────────────────────────────────────────────

const PREF_KEY = 'diglot.prefs.v1';
const VOCAB_KEY = 'diglot.vocab.v1';

const defaultPrefs = {
  level: 25, articles: true, firstHint: false, readerSize: 19,
  apiKey: '', model: MODELS[0].id, voiceEs: '', voiceEn: '', rate: 1, lastDoc: null,
  // listening
  echo: 'first', wordGap: 0, autoAdvance: true, sleep: 0, listen: null,
  // audio export
  ttsProvider: 'google', ttsKeys: {}, ttsVoices: {},
  voiceEs2: '', drillGap: 2600, drillRepeat: false, drillCover: true,
};

const load = (key, fallback) => {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
  catch { return { ...fallback }; }
};
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };

const prefs = load(PREF_KEY, defaultPrefs);
const vocabRaw = load(VOCAB_KEY, { known: [], blocked: [], met: {} });
const vocab = {
  known: new Set(vocabRaw.known),
  blocked: new Set(vocabRaw.blocked),
  met: vocabRaw.met || {},
};
const savePrefs = () => save(PREF_KEY, prefs);
const saveVocab = () => save(VOCAB_KEY, {
  known: [...vocab.known], blocked: [...vocab.blocked], met: vocab.met,
});

// Documents can be whole books, so they live in IndexedDB rather than localStorage.
const db = {
  open() {
    if (this._p) return this._p;
    this._p = new Promise((resolve, reject) => {
      const req = indexedDB.open('diglot', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('docs', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._p;
  },
  async tx(mode, fn) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('docs', mode);
      const request = fn(transaction.objectStore('docs'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
    });
  },
  put(doc) { return this.tx('readwrite', (store) => store.put(doc)); },
  get(id) { return this.tx('readonly', (store) => store.get(id)); },
  all() { return this.tx('readonly', (store) => store.getAll()); },
  remove(id) { return this.tx('readwrite', (store) => store.delete(id)); },
};

// ── state ───────────────────────────────────────────────────────────────────

const state = {
  doc: null,          // { id, title, author, source, sections: [text], extra: [] }
  sectionIndex: 0,
  analysis: null,     // cached analysis of the current section
  index: DEFAULT_INDEX,
  rendered: null,     // last applyLevel result
  narration: null,    // sentences and runs — what the reader draws and the voice says
  sentenceEls: [],    // sentence index → element
  partEls: new Map(), // "sentence:part" → the Spanish word's element
  speakers: [],       // dialogue speakers, in the order they first talk
  mode: 'read',       // 'read' | 'drill'
};

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// ── sample text (original, written for this app) ────────────────────────────

const SAMPLE = {
  title: 'The woman who counted the boats',
  author: 'A sample, to show you the idea',
  text: `Every morning the old woman walked to the harbour with a small green notebook.
She counted the boats. Nine on a good day, three when the wind came from the north,
and once, in a bad winter, none at all.

Her neighbours thought this was a strange habit for a woman of eighty years. The
young men who worked on the water laughed a little, but they always waved. She
wrote the numbers in the same careful hand she had used as a teacher, forty years
before, in a school two streets away.

Nobody asked her why she did it, and so nobody learned that her husband had been a
fisherman, and that he had gone out one September night with four other men and a
new engine, and that only three of them came home. After that she needed to know,
every day, how many boats were on the water, and how many came back.

The notebook was almost full. When it finished she would buy another one, from the
shop near the church, where the woman behind the counter always said good morning
and never asked about the counting.`,
};

// ── weaving ─────────────────────────────────────────────────────────────────

function rebuildIndex() {
  const extra = state.doc?.extra?.length ? entriesToBands(state.doc.extra) : null;
  if (!extra) { state.index = DEFAULT_INDEX; return; }
  // Merge Claude's entries into the standard bands, tier by tier, so a word it
  // rates "tier 3" appears at the same point on the dial as a band-2 staple.
  const merged = BANDS.map((band, i) => [...band, ...(extra[i] || [])]);
  for (let i = BANDS.length; i < extra.length; i++) merged.push(extra[i]);
  state.index = buildIndex(merged);
}

function currentText() {
  if (!state.doc) return '';
  return state.doc.sections[state.sectionIndex] || '';
}

function reanalyze() {
  const text = currentText();
  state.analysis = text ? analyze(text, state.index) : null;
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function narrationOptions() {
  return { ...NARRATION_DEFAULTS, echo: prefs.echo, wordGap: Number(prefs.wordGap) || 0 };
}

function render() {
  const reader = $('reader');
  reader.textContent = '';
  state.sentenceEls = [];
  state.partEls = new Map();
  $('btnDrill').hidden = !(state.doc?.phrases?.length);
  $('btnDrill').classList.toggle('on', state.mode === 'drill');
  if (state.mode === 'drill') { renderDrill(reader); return; }
  if (!state.analysis) {
    state.narration = null;
    reader.append(el('p', 'empty', 'Add some text to start reading — an article URL, a paste, a topic, or an EPUB.'));
    $('actualOut').textContent = '0';
    renderSectionNav();
    return;
  }

  const result = applyLevel(state.analysis, {
    level: prefs.level,
    articles: prefs.articles,
    firstHint: prefs.firstHint,
    known: vocab.known,
    blocked: vocab.blocked,
  });
  state.rendered = result;

  if (state.sectionIndex === 0) {
    reader.append(el('h1', 'title', state.doc.title));
    if (state.doc.author || state.doc.source) {
      reader.append(el('div', 'byline', [state.doc.author, state.doc.source].filter(Boolean).join(' · ')));
    }
  }

  // The narration decides where sentences and paragraphs begin, and the page is
  // drawn from that same structure — so the highlight always matches the voice.
  const narration = buildNarration(result.nodes, narrationOptions());
  state.narration = narration;
  state.speakers = [...new Set(narration.sentences.map((x) => x.speaker).filter(Boolean))];

  let paragraph = null;
  const closeParagraph = () => {
    if (paragraph && paragraph.hasChildNodes()) reader.append(paragraph);
    paragraph = null;
  };

  for (const sentence of narration.sentences) {
    if (sentence.paragraphStart || !paragraph) { closeParagraph(); paragraph = el('p'); }
    const sentenceEl = el('span', 'sentence');
    sentenceEl.dataset.s = String(sentence.index);

    sentence.parts.forEach((part, partIndex) => {
      if (part.type === 'speaker') {
        const slot = speakerSlot(part.speaker);
        sentenceEl.append(el('b', slot ? 'who b' : 'who', part.text.replace(/:$/, '')));
        return;
      }
      if (part.type === 'text') {
        sentenceEl.append(document.createTextNode(part.text));
        return;
      }
      const node = part.node;
      const span = el('span', vocab.known.has(node.key) ? 'es known' : 'es', node.text);
      span.dataset.en = node.en;
      span.dataset.key = node.key;
      span.dataset.rank = node.rank;
      span.dataset.pos = node.pos;
      span.dataset.s = String(sentence.index);
      if (node.hint) span.append(el('span', 'hint', ` (${node.hint})`));
      state.partEls.set(`${sentence.index}:${partIndex}`, span);
      sentenceEl.append(span);
    });

    state.sentenceEls[sentence.index] = sentenceEl;
    paragraph.append(sentenceEl);
    if (sentence.endsParagraph) closeParagraph();
  }
  closeParagraph();

  for (const node of result.nodes) {
    if (node.kind === 'swap' && node.first && node.pos !== 'det') {
      vocab.met[node.key] = (vocab.met[node.key] || 0) + 1;
    }
  }
  saveVocabThrottled();

  $('actualOut').textContent = Math.round(result.stats.ratio * 100);
  $('stageOut').textContent = stageName(prefs.level);
  renderSectionNav();
  onTextRerendered();
}

/** Which voice a speaker gets: first speaker one way, second the other. */
function speakerSlot(name) {
  if (!name) return 0;
  const at = state.speakers.indexOf(name);
  return at < 0 ? 0 : at % 2;
}

/** Listen-and-repeat: the English, a gap, then the Spanish. */
function renderDrill(reader) {
  const phrases = state.doc?.phrases || [];
  state.narration = { sentences: buildDrill(phrases, { gap: prefs.drillGap, repeat: prefs.drillRepeat }) };
  state.speakers = [];

  reader.append(el('h1', 'title', state.doc.title));
  reader.append(el('div', 'byline', `${phrases.length} phrases · say each one into the gap, then hear it`));

  const list = el('div', 'drill' + (prefs.drillCover ? ' cover' : ''));
  phrases.forEach((phrase, i) => {
    const row = el('div', 'row');
    row.append(el('span', 'en', phrase.en));
    row.append(el('span', 'es', phrase.es));
    row.onclick = () => {
      row.classList.add('shown');
      if (!player.active) speakOne(phrase.es);
      else listenFrom(i);
    };
    state.sentenceEls[i] = row;
    list.append(row);
  });
  reader.append(list);

  const options = el('div', 'section-nav');
  const cover = el('button', 'btn' + (prefs.drillCover ? ' on' : ''), prefs.drillCover ? 'Spanish hidden' : 'Spanish shown');
  cover.onclick = () => { prefs.drillCover = !prefs.drillCover; savePrefs(); render(); };
  const repeat = el('button', 'btn' + (prefs.drillRepeat ? ' on' : ''), prefs.drillRepeat ? 'Says it twice' : 'Says it once');
  repeat.onclick = () => { prefs.drillRepeat = !prefs.drillRepeat; savePrefs(); render(); };
  const gap = el('select');
  [['1600', 'Short gap'], ['2600', 'Normal gap'], ['4000', 'Long gap']].forEach(([v, label]) => {
    const o = el('option', null, label); o.value = v; gap.append(o);
  });
  gap.value = String(prefs.drillGap);
  gap.onchange = () => { prefs.drillGap = Number(gap.value); savePrefs(); render(); };
  options.append(cover, repeat, gap);
  reader.append(options);

  $('actualOut').textContent = '100';
  $('stageOut').textContent = 'phrase drill';
  onTextRerendered();
}

function stageName(level) {
  if (level === 0) return 'plain English';
  if (level < 15) return 'easing in';
  if (level < 35) return 'first hundred words';
  if (level < 55) return 'everyday vocabulary';
  if (level < 75) return 'reading properly';
  if (level < 95) return 'mostly Spanish';
  return 'English glue only';
}

let vocabTimer = null;
function saveVocabThrottled() {
  clearTimeout(vocabTimer);
  vocabTimer = setTimeout(saveVocab, 800);
}

function renderSectionNav() {
  const nav = $('sectionNav');
  nav.textContent = '';
  if (state.mode === 'drill') return;
  if (!state.doc || state.doc.sections.length < 2) return;
  const prev = el('button', 'btn', '← Previous');
  const next = el('button', 'btn', 'Next →');
  const label = el('div', 'readout', `Part ${state.sectionIndex + 1} of ${state.doc.sections.length}`);
  prev.disabled = state.sectionIndex === 0;
  next.disabled = state.sectionIndex >= state.doc.sections.length - 1;
  prev.onclick = () => gotoSection(state.sectionIndex - 1);
  next.onclick = () => gotoSection(state.sectionIndex + 1);
  nav.append(prev, label, next);
}

function gotoSection(i, { keepPlaying = false } = {}) {
  const wasPlaying = keepPlaying && player.active;
  if (!keepPlaying) stopListening();
  state.sectionIndex = Math.max(0, Math.min(i, state.doc.sections.length - 1));
  state.doc.position = state.sectionIndex;
  db.put(state.doc).catch(() => {});
  reanalyze();
  if (wasPlaying) { player.sentence = 0; player.run = 0; }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── loading documents ───────────────────────────────────────────────────────

async function loadDoc(doc, { persist = true } = {}) {
  stopListening();
  if (!doc.phrases?.length) state.mode = 'read';
  state.doc = doc;
  state.sectionIndex = Math.min(doc.position || 0, doc.sections.length - 1);
  rebuildIndex();
  reanalyze();
  $('docTitle').textContent = `${doc.title}${doc.sections.length > 1 ? ` · ${doc.sections.length} parts` : ''}`;
  prefs.lastDoc = doc.id;
  savePrefs();
  if (persist) await db.put(doc).catch(() => {});
  render();
  updateEnrichButton();
  window.scrollTo({ top: 0 });
}

function makeDoc({ title, author = '', source = '', text }) {
  const clean = cleanText(text);
  return {
    id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title || guessTitle(clean),
    author, source,
    sections: splitIntoSections(clean, 900),
    words: wordCount(clean),
    added: Date.now(),
    position: 0,
    extra: [],
  };
}

// ── panels ──────────────────────────────────────────────────────────────────

function openPanel(title, build) {
  $('panelTitle').textContent = title;
  const body = $('panelBody');
  body.textContent = '';
  build(body);
  $('panel').classList.add('open');
  $('scrim').classList.add('open');
}
function closePanel() {
  $('panel').classList.remove('open');
  $('scrim').classList.remove('open');
  refreshAudioEstimate = null;
}

function field(label, control, help) {
  const wrap = el('div', 'field');
  if (label) wrap.append(el('label', null, label));
  wrap.append(control);
  if (help) wrap.append(el('div', 'help', help));
  return wrap;
}

function checkbox(label, checked, onChange, help) {
  const wrap = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.onchange = () => onChange(input.checked);
  const text = el('span', null, label);
  if (help) text.append(el('small', null, help));
  wrap.append(input, text);
  return wrap;
}

// ── add text ────────────────────────────────────────────────────────────────

function panelAdd(initialTab = 'paste') {
  openPanel('Add something to read', (body) => {
    const tabs = el('div', 'tabs');
    const pane = el('div');
    const status = el('div', 'status');
    const options = [
      ['paste', 'Paste'], ['url', 'Web page'], ['queue', 'A list of them'],
      ['topic', 'Write me one'], ['file', 'Book / file'],
    ];
    let active = initialTab;
    const draw = () => {
      tabs.textContent = '';
      options.forEach(([id, label]) => {
        const tab = el('button', 'tab' + (id === active ? ' on' : ''), label);
        tab.onclick = () => { active = id; draw(); };
        tabs.append(tab);
      });
      pane.textContent = '';
      status.textContent = '';
      status.className = 'status';
      ({ paste: paneP, url: paneU, queue: paneQ, topic: paneT, file: paneF })[active](pane, status);
    };

    const paneP = (host) => {
      const box = el('textarea');
      box.placeholder = 'Paste an article, an email, your own writing — anything in English.';
      const title = el('input');
      title.type = 'text';
      title.placeholder = 'Title (optional)';
      const go = el('button', 'btn primary', 'Read it');
      go.onclick = async () => {
        if (!box.value.trim()) { fail(status, 'Nothing pasted yet.'); return; }
        await loadDoc(makeDoc({ title: title.value.trim(), text: box.value }));
        closePanel();
      };
      host.append(field(null, box), field(null, title), go);
    };

    const paneU = (host) => {
      const input = el('input');
      input.type = 'url';
      input.placeholder = 'https://example.com/an-article';
      const go = el('button', 'btn primary', 'Fetch and weave');
      go.onclick = async () => {
        const url = input.value.trim();
        if (!url) { fail(status, 'Paste a link first.'); return; }
        busy(status, 'Fetching the page…');
        try {
          const article = await fetchArticle(url);
          const doc = makeDoc({
            title: article.title, text: article.text,
            source: new URL(article.url).hostname.replace(/^www\./, ''),
          });
          await loadDoc(doc);
          closePanel();
        } catch (err) { fail(status, err.message); }
      };
      host.append(
        field('Article URL', input, 'The page is fetched through a public reader service (r.jina.ai, then allorigins) because a browser cannot read another site directly. Paywalled pages usually will not work — paste the text instead.'),
        go, status,
      );
    };

    const paneQ = (host, status) => {
      const box = el('textarea');
      box.placeholder = 'One per line. A link is fetched; anything else is a topic Claude writes about.\n\nhttps://example.com/an-article\nhow sourdough works\nthe history of Wexford harbour';
      const combined = { value: false };
      const results = el('div');
      const go = el('button', 'btn primary', 'Add them all');

      go.onclick = async () => {
        const lines = box.value.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) { fail(status, 'Nothing in the list yet.'); return; }
        results.textContent = '';
        const collected = [];
        let firstDoc = null;
        for (const [i, line] of lines.entries()) {
          busy(status, `${i + 1} of ${lines.length}: ${line.slice(0, 50)}…`);
          const row = el('div', 'card');
          const grow = el('div', 'grow');
          grow.append(el('h3', null, line.length > 60 ? line.slice(0, 57) + '…' : line));
          const note = el('div', 'sub', 'working…');
          grow.append(note);
          row.append(grow);
          results.append(row);
          try {
            const item = isLink(line)
              ? await fetchArticle(line).then((a) => ({
                title: a.title, text: a.text, source: new URL(a.url).hostname.replace(/^www\./, ''),
              }))
              : await writeFromTopic(line);
            if (!item.text || item.text.split(/\s+/).length < 40) throw new Error('too little text came back');
            note.textContent = `${item.title || 'Untitled'} · ${wordCount(item.text)} words`;
            if (combined.value) collected.push(item);
            else {
              const doc = makeDoc(item);
              await db.put(doc);
              if (!firstDoc) firstDoc = doc;
            }
          } catch (err) {
            note.textContent = err.message;
            row.style.opacity = '.7';
          }
        }

        if (combined.value && collected.length) {
          const text = collected.map((item) => `${item.title}\n\n${item.text}`).join('\n\n');
          firstDoc = makeDoc({ title: `Reading list — ${new Date().toLocaleDateString()}`, text, source: `${collected.length} pieces` });
          await db.put(firstDoc);
        }
        if (firstDoc) {
          done(status, 'Done. Opening the first one — the rest are in your library.');
          await loadDoc(firstDoc, { persist: false });
        } else fail(status, 'None of them worked.');
      };

      host.append(
        field('Links and topics', box, 'Links are fetched through the same reader service as a single page. Topics need an Anthropic API key.'),
        checkbox('Join them into one document', false, (v) => { combined.value = v; },
          'Otherwise each one becomes its own piece in the library.'),
        go, results,
      );
    };

    const paneT = (host) => {
      const input = el('input');
      input.type = 'text';
      input.placeholder = 'e.g. how sourdough works, or the history of Wexford harbour';
      const form = el('select');
      [['article', 'An article to read'], ['dialogue', 'A dialogue, with its key phrases']]
        .forEach(([v, l]) => { const o = el('option', null, l); o.value = v; form.append(o); });
      const length = el('select');
      [['250', 'Short — 250 words'], ['400', 'Medium — 400 words'], ['700', 'Long — 700 words']]
        .forEach(([v, l]) => { const o = el('option', null, l); o.value = v; length.append(o); });
      length.value = '400';
      form.onchange = () => { length.disabled = form.value === 'dialogue'; };
      const go = el('button', 'btn primary', 'Write it');
      go.onclick = async () => {
        if (!prefs.apiKey) { fail(status, 'This one needs an Anthropic API key — add it in Settings.'); return; }
        const topic = input.value.trim();
        if (!topic) { fail(status, 'What should it be about?'); return; }
        busy(status, 'Writing…');
        try {
          const item = await writeFromTopic(topic, {
            form: form.value, words: Number(length.value),
          });
          const doc = makeDoc(item);
          if (item.phrases?.length) { doc.kind = 'scene'; doc.phrases = item.phrases; }
          await loadDoc(doc);
          busy(status, 'Aligning the vocabulary…');
          await enrich(doc, status);
          closePanel();
        } catch (err) { fail(status, err.message); }
      };
      host.append(
        field('Topic or situation', input, prefs.apiKey ? 'Claude writes it, then aligns its vocabulary so the whole thing can go Spanish. A dialogue also comes back with its key phrases in full Spanish, ready to drill.' : 'Needs an Anthropic API key (Settings).'),
        field('What to write', form), field('Length', length), go, status,
      );
    };

    const paneF = (host) => {
      const input = el('input');
      input.type = 'file';
      input.accept = '.epub,.txt,.md,.html';
      const go = el('button', 'btn primary', 'Load');
      go.onclick = async () => {
        const file = input.files?.[0];
        if (!file) { fail(status, 'Choose a file first.'); return; }
        busy(status, `Reading ${file.name}…`);
        try {
          if (/\.epub$/i.test(file.name)) {
            const book = await readEpub(await file.arrayBuffer());
            const doc = makeDoc({ title: book.title, author: book.author, text: book.chapters[0].text, source: 'EPUB' });
            doc.sections = book.chapters.flatMap((ch) => splitIntoSections(cleanText(ch.text), 900));
            doc.words = doc.sections.reduce((n, s) => n + wordCount(s), 0);
            await loadDoc(doc);
          } else {
            const text = await file.text();
            const body = /\.html?$/i.test(file.name)
              ? new DOMParser().parseFromString(text, 'text/html').body.textContent
              : text;
            await loadDoc(makeDoc({ title: file.name.replace(/\.[^.]+$/, ''), text: body, source: 'file' }));
          }
          closePanel();
        } catch (err) { fail(status, err.message); }
      };
      host.append(
        field('EPUB, .txt, .md or .html', input, 'The file never leaves your browser. DRM-free EPUBs only — a Kindle .azw will not open. Project Gutenberg is a good source of free books.'),
        go, status,
      );
    };

    body.append(tabs, pane, status);
    draw();
  });
}

const isLink = (line) => /^(https?:\/\/|www\.)/i.test(line) || /^[\w-]+(\.[\w-]+)+\/\S/.test(line);

/** One topic → a written piece. Used by the topic tab and the bulk queue. */
async function writeFromTopic(topic, { form = 'article', words = 400 } = {}) {
  if (!prefs.apiKey) throw new Error('needs an Anthropic API key (Settings)');
  if (form === 'dialogue') {
    const scene = await writeScene(topic, { apiKey: prefs.apiKey, model: prefs.model });
    return { title: scene.title, text: scene.text, phrases: scene.phrases, source: 'dialogue written for you' };
  }
  const article = await writeArticle(topic, { apiKey: prefs.apiKey, model: prefs.model, words });
  return { title: article.title, text: article.text, source: 'written for you' };
}

const busy = (node, message) => {
  node.className = 'status';
  node.textContent = '';
  node.append(el('span', 'spinner'), document.createTextNode(message));
};
const fail = (node, message) => { node.className = 'status error'; node.textContent = message; };
const done = (node, message) => { node.className = 'status'; node.textContent = message; };

// ── Claude enrichment ───────────────────────────────────────────────────────

async function enrich(doc, status) {
  if (!prefs.apiKey) throw new Error('Add an Anthropic API key in Settings first.');
  const text = doc.sections.join('\n\n');
  const entries = await alignDocument(text, {
    apiKey: prefs.apiKey,
    model: prefs.model,
    onProgress: ({ done: d, total }) => status && busy(status, `Aligning vocabulary… part ${Math.min(d + 1, total)} of ${total}`),
  });
  doc.extra = entries;
  await db.put(doc).catch(() => {});
  if (state.doc?.id === doc.id) {
    rebuildIndex();
    reanalyze();
    render();
  }
  updateEnrichButton();
  status && done(status, `Added ${entries.length} words from this text.`);
  return entries.length;
}

function updateEnrichButton() {
  let button = $('btnEnrich');
  if (!state.doc) { button?.remove(); return; }
  if (!button) {
    button = el('button', 'btn ghost', '');
    button.id = 'btnEnrich';
    button.onclick = onEnrichClick;
    $('btnStats').before(button);
  }
  const count = state.doc.extra?.length || 0;
  button.textContent = count ? `✦ ${count} words` : '✦ Enrich';
  button.title = count
    ? `Claude aligned ${count} extra words for this text. Click to redo.`
    : 'Use Claude to translate this text’s own vocabulary, so the dial can go all the way up.';
  button.classList.toggle('on', count > 0);
}

async function onEnrichClick() {
  if (!prefs.apiKey) { panelSettings('You need an Anthropic API key for this.'); return; }
  openPanel('Enrich with Claude', (body) => {
    const status = el('div', 'status');
    body.append(el('div', 'note', 'Claude reads this text and returns the Spanish for its own vocabulary, in context, each rated for difficulty. Those words join the dial — so a piece about sailing gets its sailing words, not just the standard list. Your key is sent only to api.anthropic.com.'));
    body.append(status);
    busy(status, 'Starting…');
    enrich(state.doc, status).catch((err) => fail(status, err.message));
  });
}

// ── library ─────────────────────────────────────────────────────────────────

function panelLibrary() {
  openPanel('Library', async (body) => {
    body.append(el('div', 'empty', 'Loading…'));
    const docs = (await db.all()) || [];
    body.textContent = '';
    const sample = el('button', 'btn', 'Load the sample passage');
    sample.onclick = async () => {
      await loadDoc(makeDoc({ title: SAMPLE.title, author: SAMPLE.author, text: SAMPLE.text }));
      closePanel();
    };
    body.append(field(null, sample));
    if (!docs.length) { body.append(el('div', 'empty', 'Nothing saved yet.')); return; }
    docs.sort((a, b) => b.added - a.added);
    for (const doc of docs) {
      const card = el('div', 'card');
      const grow = el('div', 'grow');
      grow.append(el('h3', null, doc.title));
      const bits = [
        `${doc.words || 0} words`,
        doc.sections.length > 1 ? `${doc.sections.length} parts` : null,
        doc.source || null,
        doc.extra?.length ? `✦ ${doc.extra.length}` : null,
      ].filter(Boolean);
      grow.append(el('div', 'sub', bits.join(' · ')));
      if (doc.sections.length > 1) {
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = `${Math.round(((doc.position || 0) / (doc.sections.length - 1)) * 100)}%`;
        bar.append(fill);
        grow.append(bar);
      }
      const open = el('button', 'btn', 'Read');
      open.onclick = async () => { await loadDoc(doc, { persist: false }); closePanel(); };
      const remove = el('button', 'btn ghost', '✕');
      remove.title = 'Delete';
      remove.onclick = async () => { await db.remove(doc.id); card.remove(); };
      card.append(grow, open, remove);
      body.append(card);
    }
  });
}

// ── everyday scenes ─────────────────────────────────────────────────────────

async function loadScene(scene, { drill = false } = {}) {
  const doc = makeDoc({ title: scene.title, author: scene.blurb, text: sceneToText(scene), source: 'scene' });
  doc.kind = 'scene';
  doc.sceneId = scene.id;
  doc.phrases = scene.phrases;
  state.mode = drill ? 'drill' : 'read';
  await loadDoc(doc);
}

function panelScenes() {
  openPanel('Everyday scenes', (body) => {
    body.append(el('div', 'note', 'Short dialogues for the situations you actually stand in. Read one at your current setting, or drill its phrases: the English, a gap to say it into, then the Spanish. The phrases are written out in full — at a till you want the thing people say, not a word-by-word weave.'));

    const everything = el('button', 'btn', `Drill all ${allPhrases().length} phrases`);
    everything.onclick = async () => {
      const doc = makeDoc({ title: 'Every phrase', author: 'All the scenes, shuffled together', text: 'Phrase drill.', source: 'drill' });
      doc.kind = 'scene';
      doc.phrases = allPhrases();
      state.mode = 'drill';
      await loadDoc(doc);
      closePanel();
    };
    body.append(field(null, everything));

    for (const group of sceneGroups()) {
      const head = el('div', 'field');
      head.append(el('label', null, group.name));
      body.append(head);
      for (const scene of group.scenes) {
        const card = el('div', 'card');
        const grow = el('div', 'grow');
        grow.append(el('h3', null, scene.title));
        grow.append(el('div', 'sub', `${scene.blurb} · ${scene.turns.length} turns · ${scene.phrases.length} phrases`));
        const read = el('button', 'btn', 'Read');
        read.onclick = async () => { await loadScene(scene); closePanel(); };
        const drill = el('button', 'btn ghost', 'Drill');
        drill.onclick = async () => { await loadScene(scene, { drill: true }); closePanel(); };
        card.append(grow, read, drill);
        body.append(card);
      }
    }
  });
}

// ── progress ────────────────────────────────────────────────────────────────

function panelStats() {
  openPanel('Progress', (body) => {
    const met = Object.keys(vocab.met).length;
    const stats = el('div', 'stats');
    [[met, 'words met'], [vocab.known.size, 'marked known'], [vocab.blocked.size, 'set aside'],
     [state.rendered ? Math.round(state.rendered.stats.ratio * 100) + '%' : '—', 'this page']]
      .forEach(([n, label]) => {
        const box = el('div');
        box.append(el('b', null, String(n)), document.createTextNode(label));
        stats.append(box);
      });
    body.append(stats);

    body.append(el('div', 'note', 'Words you mark as known stay Spanish even when you drag the dial back down — the text keeps what you have learned and only softens what you have not. Words you set aside never turn Spanish.'));

    const section = (title, keys, onClear) => {
      if (!keys.length) return;
      const head = el('div', 'field');
      head.append(el('label', null, `${title} (${keys.length})`));
      const list = el('div', 'wordlist');
      keys.slice(0, 400).forEach((key) => {
        const chip = el('span', 'chip');
        chip.append(el('b', null, key));
        chip.style.cursor = 'pointer';
        chip.title = 'Remove';
        chip.onclick = () => { onClear(key); chip.remove(); scheduleRender(); };
        list.append(chip);
      });
      head.append(list);
      body.append(head);
    };
    section('Known', [...vocab.known], (k) => { vocab.known.delete(k); saveVocab(); });
    section('Set aside', [...vocab.blocked], (k) => { vocab.blocked.delete(k); saveVocab(); });

    const metList = Object.entries(vocab.met).sort((a, b) => b[1] - a[1]).slice(0, 200);
    if (metList.length) {
      const head = el('div', 'field');
      head.append(el('label', null, 'Seen most often'));
      const list = el('div', 'wordlist');
      metList.forEach(([key, count]) => {
        const chip = el('span', 'chip');
        chip.append(el('b', null, key), document.createTextNode(` ×${count}`));
        list.append(chip);
      });
      head.append(list);
      body.append(head);
    }
  });
}

// ── export ──────────────────────────────────────────────────────────────────

function panelExport() {
  openPanel('Export', (body) => {
    if (!state.doc) { body.append(el('div', 'empty', 'Load something first.')); return; }
    const options = { gloss: true, vocab: true, whole: true };
    const status = el('div', 'status');

    body.append(el('div', 'note', 'The EPUB is woven at the dial’s current setting — it is a snapshot, not a slider, so pick the level you want before exporting. Send it to your Kindle by emailing it to your @kindle.com address, or with the Send to Kindle app.'));
    body.append(checkbox('Gloss each Spanish word the first time it appears', options.gloss, (v) => { options.gloss = v; }, 'Adds the English in small type, once.'));
    body.append(checkbox('Add a vocabulary list at the end', options.vocab, (v) => { options.vocab = v; }));
    body.append(checkbox('Whole document, not just this part', options.whole, (v) => {
      options.whole = v;
      refreshAudioEstimate?.();
    }));

    const saveAs = async (build, filename, type, message) => {
      busy(status, 'Building…');
      try {
        await download(build(), filename, type);
        done(status, message);
      } catch (err) { fail(status, err.message); }
    };

    const epub = el('button', 'btn primary', '↓ EPUB for Kindle');
    epub.onclick = () => saveAs(
      () => exportEpub(options),
      `${safeName(state.doc.title)}-${prefs.level}pc.epub`, 'application/epub+zip',
      'Saved. Email it to your Kindle address to read it there.',
    );
    const txt = el('button', 'btn', '↓ Plain text');
    txt.onclick = () => saveAs(
      () => sectionsToExport(options.whole).map((s) => weaveText(s)).join('\n\n* * *\n\n'),
      `${safeName(state.doc.title)}-${prefs.level}pc.txt`, 'text/plain', 'Saved.',
    );
    const csv = el('button', 'btn', '↓ Vocabulary CSV');
    csv.onclick = () => {
      const rows = collectVocab(options.whole);
      return saveAs(
        () => 'spanish,english\n' + rows.map((r) => `"${r.es}","${r.en}"`).join('\n'),
        `${safeName(state.doc.title)}-vocab.csv`, 'text/csv',
        `${rows.length} words — ready for Anki or a spreadsheet.`,
      );
    };
    const row = el('div', 'row2');
    row.append(epub, txt, csv);
    body.append(row, status);

    body.append(el('div', 'note', 'Kindle tip: in your Amazon account under “Preferences → Personal Document Settings” you will find your Send-to-Kindle email address, and the list of addresses allowed to send to it. Add your own email there first, or Amazon will drop the file.'));

    body.append(el('hr', 'section-break'));
    buildAudioSection(body, options);
  });
}

// ── audio export ────────────────────────────────────────────────────────────

// Set while the export panel is open, so the scope checkbox can re-price.
let refreshAudioEstimate = null;

function buildAudioSection(body, options) {
  const heading = el('div', 'field');
  heading.append(el('label', null, 'Audiobook (MP3)'));
  body.append(heading);
  body.append(el('div', 'note', 'The Listen button uses your device\u2019s own voices, which are free but cannot be recorded. For a file — for your phone, the car, a run — this calls a cloud voice service with your key: each Spanish word to a Spanish voice, each gloss to an English one, joined into one MP3. Current Kindles will not play a sideloaded MP3; this is for a phone.'));

  const provider = el('select');
  Object.values(PROVIDERS).forEach((p) => { const o = el('option', null, p.label); o.value = p.id; provider.append(o); });
  provider.value = prefs.ttsProvider;

  const key = el('input');
  key.type = 'password';
  key.autocomplete = 'off';

  const esVoice = el('select');
  const enVoice = el('select');
  const loadVoices = el('button', 'btn', 'Load voices');
  const status = el('div', 'status');
  const cost = el('div', 'help');

  const keyFor = () => prefs.ttsKeys[provider.value] || '';
  const voicesFor = () => prefs.ttsVoices[provider.value] || {};

  const fillVoiceSelect = (select, list, lang, current) => {
    select.textContent = '';
    const auto = el('option', null, list.length ? 'Choose a voice' : 'Load voices first');
    auto.value = '';
    select.append(auto);
    const filtered = lang && list.some((v) => v.lang)
      ? list.filter((v) => v.lang.toLowerCase().startsWith(lang))
      : list;
    filtered.forEach((v) => { const o = el('option', null, v.name); o.value = v.id; select.append(o); });
    select.value = current && filtered.some((v) => v.id === current) ? current : '';
  };

  const showCost = () => {
    if (!state.doc) return;
    const sentences = narrationFor(options.whole);
    const guess = estimateAudio(sentences, { provider: provider.value });
    cost.textContent = `${guess.characters.toLocaleString()} characters over ${guess.requests} requests — roughly ${guess.minutes} minutes of audio. Glossing fewer words (Settings) makes both smaller.`;
  };

  const syncProvider = () => {
    key.value = keyFor();
    key.placeholder = PROVIDERS[provider.value].keyLabel;
    const stored = voicesFor();
    fillVoiceSelect(esVoice, [], 'es', stored.es);
    fillVoiceSelect(enVoice, [], 'en', stored.en);
    if (stored.esName) { const o = el('option', null, stored.esName); o.value = stored.es; esVoice.append(o); esVoice.value = stored.es; }
    if (stored.enName) { const o = el('option', null, stored.enName); o.value = stored.en; enVoice.append(o); enVoice.value = stored.en; }
    showCost();
  };

  provider.onchange = () => { prefs.ttsProvider = provider.value; savePrefs(); syncProvider(); };
  key.oninput = () => { prefs.ttsKeys[provider.value] = key.value.trim(); savePrefs(); };
  const rememberVoice = (lang, select) => {
    const store = prefs.ttsVoices[provider.value] || (prefs.ttsVoices[provider.value] = {});
    store[lang] = select.value;
    store[lang + 'Name'] = select.selectedOptions[0]?.textContent || '';
    savePrefs();
  };
  esVoice.onchange = () => rememberVoice('es', esVoice);
  enVoice.onchange = () => rememberVoice('en', enVoice);

  loadVoices.onclick = async () => {
    if (!keyFor()) { fail(status, 'Add the key first.'); return; }
    busy(status, 'Fetching the voice list…');
    try {
      const list = await listVoices(provider.value, { apiKey: keyFor() });
      const stored = voicesFor();
      fillVoiceSelect(esVoice, list, 'es', stored.es);
      fillVoiceSelect(enVoice, list, 'en', stored.en);
      done(status, `${list.length} voices. Pick one for each language.`);
    } catch (err) { fail(status, err.message); }
  };

  const render = el('button', 'btn primary', '↓ Render MP3');
  let cancel = null;
  render.onclick = async () => {
    if (cancel) { cancel.abort(); cancel = null; render.textContent = '↓ Render MP3'; return; }
    if (!keyFor()) { fail(status, 'Add an API key for the voice service.'); return; }
    cancel = new AbortController();
    render.textContent = 'Stop';
    busy(status, 'Starting…');
    try {
      const sentences = narrationFor(options.whole);
      const result = await renderAudio(sentences, {
        provider: provider.value,
        apiKey: keyFor(),
        voices: { es: esVoice.value, en: enVoice.value },
        rate: Number(prefs.rate) || 1,
        signal: cancel.signal,
        onProgress: ({ done: d, total }) => busy(status, `Voicing ${d} of ${total} passages…`),
      });
      busy(status, 'Saving…');
      await download(result.blob, `${safeName(state.doc.title)}-${prefs.level}pc.mp3`, 'audio/mpeg');
      done(status, `Done — ${result.requests} passages, ${result.characters.toLocaleString()} characters.`);
    } catch (err) {
      if (err.name === 'AbortError') done(status, 'Stopped.');
      else fail(status, err.message);
    } finally {
      cancel = null;
      render.textContent = '↓ Render MP3';
    }
  };

  body.append(
    field('Voice service', provider, PROVIDERS[prefs.ttsProvider].keyHint),
    field('Key', key, 'Kept in this browser only, and sent only to the service you picked.'),
  );
  const voiceRow = el('div', 'row2');
  voiceRow.append(esVoice, enVoice);
  body.append(field('Spanish and English voices', voiceRow), loadVoices, field(null, render, ''), cost, status);
  refreshAudioEstimate = showCost;
  syncProvider();
}

const safeName = (s) => (s || 'diglot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

function sectionsToExport(whole) {
  return whole ? state.doc.sections : [currentText()];
}

function weaveOne(text) {
  return applyLevel(analyze(text, state.index), {
    level: prefs.level, articles: prefs.articles, firstHint: false,
    known: vocab.known, blocked: vocab.blocked,
  });
}

function weaveText(text) {
  return weaveOne(text).nodes.map((n) => n.text).join('');
}

/** Narration for a stretch of the document — used by the audio export. */
function narrationFor(whole) {
  const sentences = [];
  for (const section of sectionsToExport(whole)) {
    for (const sentence of buildNarration(weaveOne(section).nodes, narrationOptions()).sentences) {
      sentences.push({ ...sentence, index: sentences.length });
    }
  }
  return sentences;
}

function collectVocab(whole) {
  const seen = new Map();
  for (const section of sectionsToExport(whole)) {
    for (const node of weaveOne(section).nodes) {
      if (node.kind === 'swap' && node.pos !== 'det' && !seen.has(node.text.toLowerCase())) {
        seen.set(node.text.toLowerCase(), { es: node.text, en: node.en });
      }
    }
  }
  return [...seen.values()];
}

const escapeHtml = (s) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function exportEpub({ gloss, vocab: withVocab, whole }) {
  const seen = new Set();
  const chapters = sectionsToExport(whole).map((section, i) => {
    const nodes = weaveOne(section).nodes;
    let html = '<p>';
    for (const node of nodes) {
      if (node.kind === 'swap') {
        const first = !seen.has(node.key);
        seen.add(node.key);
        html += `<span class="es">${escapeHtml(node.text)}</span>`;
        if (gloss && first && node.pos !== 'det') html += ` <span class="gloss">(${escapeHtml(node.en)})</span>`;
      } else {
        html += escapeHtml(node.text).replace(/\n{2,}/g, '</p>\n<p>').replace(/\n/g, ' ');
      }
    }
    html += '</p>';
    return {
      title: whole && state.doc.sections.length > 1 ? `${state.doc.title} — part ${i + 1}` : state.doc.title,
      html: html.replace(/<p>\s*<\/p>/g, ''),
    };
  });
  return buildEpub({
    title: `${state.doc.title} (${prefs.level}% Spanish)`,
    author: state.doc.author || 'Diglot',
    chapters,
    vocab: withVocab ? collectVocab(whole) : [],
    level: prefs.level,
  });
}

// Saving a file. A plain link works everywhere the app is served normally;
// inside a sandboxed host (a published Claude artifact) links are inert, so
// hand the file to the host's own save prompt when it offers one.
let saver;
async function download(data, filename, type) {
  const blob = new Blob([data], { type });
  if (saver === undefined) {
    saver = typeof window.claude?.use === 'function'
      ? await window.claude.use('downloads').catch(() => null)
      : null;
  }
  if (saver) {
    try {
      await saver.save({ filename, data: blob });
      return;
    } catch (err) {
      if (err?.code === 'declined') throw new Error('Save cancelled.');
      if (err?.code) throw new Error(`Could not save here (${err.code}).`);
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── settings ────────────────────────────────────────────────────────────────

function panelSettings(message) {
  openPanel('Settings', (body) => {
    if (message) body.append(el('div', 'note', message));

    const size = el('input');
    size.type = 'range';
    size.min = '15'; size.max = '26'; size.value = String(prefs.readerSize);
    size.oninput = () => {
      prefs.readerSize = Number(size.value);
      document.documentElement.style.setProperty('--reader-size', prefs.readerSize + 'px');
      savePrefs();
    };
    body.append(field('Text size', size));

    body.append(checkbox('Spanish articles and possessives', prefs.articles, (v) => {
      prefs.articles = v; savePrefs(); reanalyze(); render();
    }, 'Turns "the casa" into "la casa" once the dial passes about a third.'));

    body.append(checkbox('Gloss new words in the margin of the text', prefs.firstHint, (v) => {
      prefs.firstHint = v; savePrefs(); render();
    }, 'Shows the English in small type the first time each word appears.'));

    const key = el('input');
    key.type = 'password';
    key.placeholder = 'sk-ant-…';
    key.value = prefs.apiKey;
    key.autocomplete = 'off';
    key.oninput = () => { prefs.apiKey = key.value.trim(); savePrefs(); updateEnrichButton(); };

    const model = el('select');
    MODELS.forEach((m) => { const o = el('option', null, m.label); o.value = m.id; model.append(o); });
    model.value = prefs.model;
    model.onchange = () => { prefs.model = model.value; savePrefs(); };

    const status = el('div', 'status');
    const check = el('button', 'btn', 'Test the key');
    check.onclick = async () => {
      busy(status, 'Checking…');
      try { await testKey({ apiKey: prefs.apiKey, model: prefs.model }); done(status, 'Works.'); }
      catch (err) { fail(status, err.message); }
    };

    body.append(
      el('div', 'note', 'Everything above works with no account and no key. A key adds three things: articles written to order, context-accurate translation of a text’s own vocabulary, and idioms the built-in list cannot cover. It is stored in this browser only and sent only to api.anthropic.com.'),
      field('Anthropic API key', key, 'From console.anthropic.com. Kept in this browser’s local storage.'),
      field('Model', model),
      check, status,
    );

    body.append(el('hr', 'section-break'));
    body.append(el('div', 'note', 'Listening is harder than reading — there is no hovering a word you missed. The spoken gloss covers that: the first time each Spanish word appears, an English voice says what it meant, quietly, and the sentence carries on.'));

    const echo = el('select');
    [['first', 'The first time each word appears'], ['always', 'Every time'], ['none', 'Never — Spanish only']]
      .forEach(([v, label]) => { const o = el('option', null, label); o.value = v; echo.append(o); });
    echo.value = prefs.echo;
    echo.onchange = () => { prefs.echo = echo.value; savePrefs(); render(); };
    body.append(field('Speak the English gloss', echo));

    const gap = el('select');
    [['0', 'No gap — read straight through'], ['500', 'Half a second'], ['900', 'Just under a second'], ['1400', 'A second and a half']]
      .forEach(([v, label]) => { const o = el('option', null, label); o.value = v; gap.append(o); });
    gap.value = String(prefs.wordGap);
    gap.onchange = () => { prefs.wordGap = Number(gap.value); savePrefs(); render(); };
    body.append(field('Pause after each Spanish word', gap, 'A gap long enough to say the word back is the whole of shadowing practice.'));

    body.append(checkbox('Roll on to the next part automatically', prefs.autoAdvance, (v) => {
      prefs.autoAdvance = v; savePrefs();
    }, 'A book plays chapter after chapter instead of stopping at each one.'));

    const voices = voiceList();
    if (voices.length) {
      const es = el('select');
      const en = el('select');
      const fill = (select, langPrefix, current) => {
        const auto = el('option', null, 'Automatic');
        auto.value = '';
        select.append(auto);
        voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix)).forEach((v) => {
          const o = el('option', null, `${v.name} (${v.lang})`);
          o.value = v.name;
          select.append(o);
        });
        select.value = current || '';
      };
      fill(es, 'es', prefs.voiceEs);
      fill(en, 'en', prefs.voiceEn);
      const es2 = el('select');
      fill(es2, 'es', prefs.voiceEs2);
      es2.options[0].textContent = 'Same voice, lower pitch';
      es.onchange = () => { prefs.voiceEs = es.value; savePrefs(); };
      en.onchange = () => { prefs.voiceEn = en.value; savePrefs(); };
      es2.onchange = () => { prefs.voiceEs2 = es2.value; savePrefs(); };
      body.append(
        field('Spanish voice', es),
        field('Second speaker in a dialogue', es2, 'Dialogues give each speaker their own voice. With only one Spanish voice installed, the second speaker drops in pitch instead.'),
        field('English voice', en),
      );
    }

    const reset = el('button', 'btn ghost', 'Forget my known words');
    reset.onclick = () => {
      if (!confirm('Clear every known and set-aside word? Your saved texts stay.')) return;
      vocab.known.clear();
      vocab.blocked.clear();
      vocab.met = {};
      saveVocab();
      render();
      done(status, 'Cleared.');
    };
    body.append(el('hr', 'section-break'), reset);
  });
}

// ── word popover ────────────────────────────────────────────────────────────

const pop = $('pop');
let popTarget = null;

function showPop(span) {
  popTarget = span;
  pop.textContent = '';
  const key = span.dataset.key;
  const isKnown = vocab.known.has(key);

  pop.append(el('div', 'word', span.firstChild?.textContent || span.textContent));
  pop.append(el('div', 'en', span.dataset.en));
  pop.append(el('div', 'meta', `${posName(span.dataset.pos)} · difficulty ${span.dataset.rank}/100${isKnown ? ' · known' : ''}`));

  const row = el('div', 'row');
  const say = el('button', 'btn', '🔊');
  say.title = 'Say it';
  say.onclick = () => speakOne(span.firstChild?.textContent || span.textContent);
  const here = el('button', 'btn', '▶');
  here.title = 'Read aloud from here';
  here.onclick = () => { hidePop(); listenFrom(Number(span.dataset.s) || 0); };
  const know = el('button', 'btn' + (isKnown ? ' on' : ''), isKnown ? 'Known ✓' : 'I know this');
  know.onclick = () => {
    if (isKnown) vocab.known.delete(key); else { vocab.known.add(key); vocab.blocked.delete(key); }
    saveVocab();
    hidePop();
    render();
  };
  const block = el('button', 'btn ghost', 'Too soon');
  block.title = 'Keep this word in English for now';
  block.onclick = () => {
    vocab.blocked.add(key);
    vocab.known.delete(key);
    saveVocab();
    hidePop();
    render();
  };
  row.append(say, here, know, block);
  pop.append(row);

  const rect = span.getBoundingClientRect();
  pop.style.display = 'block';
  const width = pop.offsetWidth;
  const left = Math.min(Math.max(8, rect.left + window.scrollX - width / 2 + rect.width / 2), window.innerWidth - width - 8);
  const above = rect.top > 200;
  pop.style.left = left + 'px';
  pop.style.top = (above ? rect.top + window.scrollY - pop.offsetHeight - 8 : rect.bottom + window.scrollY + 8) + 'px';
}

function hidePop() { pop.style.display = 'none'; popTarget = null; }

const posName = (pos) => ({
  n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition',
  conj: 'conjunction', pron: 'pronoun', num: 'number', det: 'article', phrase: 'phrase',
}[pos] || pos);

// ── the audiobook player ────────────────────────────────────────────────────
//
// Speaks run by run, so each Spanish word gets a Spanish voice and its English
// gloss an English one, with real silence in between. Everything is short
// utterances rather than one long one: long utterances get truncated by some
// browsers, and short ones let the highlight keep up.

const player = { active: false, paused: false, sentence: 0, run: 0, timer: null, sleepTimer: null };

// Not every browser hands out the Web Speech API — iOS Safari withholds it
// inside a sandboxed iframe, for one. Everything below goes through these, so
// a missing API costs you the Listen button and nothing else.
const synth = (() => {
  try { return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null; } catch { return null; }
})();
const canSpeak = (() => {
  try { return !!synth && typeof SpeechSynthesisUtterance === 'function'; } catch { return false; }
})();
const voiceList = () => {
  try { return synth ? synth.getVoices() || [] : []; } catch { return []; }
};
const shush = () => { try { synth?.cancel(); } catch { /* nothing to stop */ } };

function pickVoice(lang, slot = 0) {
  const voices = voiceList();
  const second = slot === 1 && lang === 'es' && prefs.voiceEs2;
  const wanted = second || (lang === 'es' ? prefs.voiceEs : prefs.voiceEn);
  const voice = voices.find((v) => v.name === wanted)
    || voices.find((v) => v.lang.toLowerCase().startsWith(lang === 'es' ? 'es' : 'en'))
    || null;
  // With only one voice installed, drop the pitch for the second speaker so
  // the two sides of a dialogue are still tellable apart.
  const pitch = slot === 1 && !second ? 0.78 : 1;
  return { voice, pitch };
}

function hasSpanishVoice() {  // eslint-disable-line
  return voiceList().some((v) => v.lang.toLowerCase().startsWith('es'));
}

/** Say a single word — the speaker button in the word popover. */
function speakOne(text) {
  if (!canSpeak) return;
  shush();
  const utterance = new SpeechSynthesisUtterance(text);
  const { voice } = pickVoice('es');
  utterance.voice = voice;
  utterance.lang = voice?.lang || 'es-ES';
  utterance.rate = Number(prefs.rate) || 1;
  synth.speak(utterance);
}

function listenFrom(sentenceIndex = 0) {
  if (!state.narration?.sentences.length) return;
  if (!canSpeak) { noVoices(); return; }
  shush();
  clearTimeout(player.timer);
  player.active = true;
  player.paused = false;
  player.sentence = Math.max(0, Math.min(sentenceIndex, state.narration.sentences.length - 1));
  player.run = 0;
  $('playbar').classList.add('on');
  $('btnListen').classList.add('on');
  $('btnListen').textContent = '■ Stop';
  $('playPause').textContent = '❙❙';
  $('playSeek').max = String(state.narration.sentences.length - 1);
  const warn = $('playWarn');
  if (hasSpanishVoice()) warn.hidden = true;
  else {
    warn.hidden = false;
    warn.textContent = 'No Spanish voice installed — the Spanish will be read with an English accent. Add one in your system\u2019s language settings.';
  }
  startSleepTimer();
  speakStep();
}

/** Where listening should pick up: where you stopped, if it was this page. */
function noVoices() {
  const warn = $('playWarn');
  $('playbar').classList.add('on');
  warn.hidden = false;
  warn.textContent = 'This browser will not let the page speak. Safari blocks it inside an embedded frame — open the page in its own tab, or use the app on your computer.';
  $('playLabel').textContent = 'No voices';
}

function resumePoint() {
  const saved = prefs.listen;
  const samePlace = saved && saved.doc === state.doc?.id
    && saved.section === state.sectionIndex && saved.mode === state.mode;
  if (samePlace) return Math.min(saved.sentence || 0, (state.narration?.sentences.length || 1) - 1);
  return 0;
}

function speakStep() {
  clearTimeout(player.timer);
  if (!player.active || player.paused) return;
  const sentences = state.narration?.sentences || [];
  if (player.sentence >= sentences.length) { finishSection(); return; }

  const sentence = sentences[player.sentence];
  const run = sentence.runs[player.run];
  if (!run) {
    player.sentence += 1;
    player.run = 0;
    rememberPosition();
    speakStep();
    return;
  }

  highlightRun(sentence, run);
  const utterance = new SpeechSynthesisUtterance(run.text);
  const { voice, pitch } = pickVoice(run.lang, speakerSlot(run.speaker));
  utterance.voice = voice;
  utterance.lang = voice?.lang || (run.lang === 'es' ? 'es-ES' : 'en-GB');
  utterance.rate = Number(prefs.rate) || 1;
  utterance.pitch = pitch;
  if (run.kind === 'prompt') utterance.rate = Math.min(2, utterance.rate * 0.95);
  if (run.kind === 'gloss') {
    // the gloss is an aside, not part of the sentence: quieter and quicker
    utterance.volume = 0.72;
    utterance.rate = Math.min(2, utterance.rate * 1.12);
  }
  let moved = false;
  const go = () => {
    if (moved || !player.active) return;
    moved = true;
    clearTimeout(watchdog);
    player.run += 1;
    const gap = Math.round((run.gapAfter || 0) / (Number(prefs.rate) || 1));
    player.timer = setTimeout(speakStep, gap);
  };
  utterance.onend = go;
  utterance.onerror = go;
  // Browsers drop onend more often than you would like — a phone locking, a
  // voice that isn't installed, Chrome's own long-utterance bug. Move on
  // anyway once the run has had more than enough time to be said.
  const seconds = run.text.length / (11 * (Number(prefs.rate) || 1));
  const watchdog = setTimeout(go, Math.max(1200, seconds * 2200));
  synth.speak(utterance);
}

function highlightRun(sentence, run) {
  document.querySelectorAll('.speaking').forEach((n) => n.classList.remove('speaking'));
  document.querySelectorAll('.saying').forEach((n) => n.classList.remove('saying'));
  const sentenceEl = state.sentenceEls[sentence.index];
  if (sentenceEl) {
    sentenceEl.classList.add('speaking');
    const box = sentenceEl.getBoundingClientRect();
    if (box.top < 70 || box.bottom > window.innerHeight - 110) {
      sentenceEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  if (run.part != null) {
    state.partEls.get(`${sentence.index}:${run.part}`)?.classList.add('saying');
  }
  $('playLabel').textContent = `${sentence.index + 1} / ${state.narration.sentences.length}`;
  $('playSeek').value = String(sentence.index);
}

function finishSection() {
  const more = state.doc && state.sectionIndex < state.doc.sections.length - 1;
  if (prefs.autoAdvance && more) {
    gotoSection(state.sectionIndex + 1, { keepPlaying: true });
    return;
  }
  stopListening();
  $('playLabel').textContent = more ? 'End of this part' : 'Finished';
}

function pauseListening() {
  player.paused = true;
  clearTimeout(player.timer);
  shush();                       // pause() is unreliable across browsers; we re-speak instead
  $('playPause').textContent = '▶';
  document.querySelectorAll('.saying').forEach((n) => n.classList.remove('saying'));
}

function resumeListening() {
  if (!player.active) { listenFrom(resumePoint()); return; }
  player.paused = false;
  $('playPause').textContent = '❙❙';
  speakStep();
}

function stopListening() {
  const wasActive = player.active;
  player.active = false;
  player.paused = false;
  clearTimeout(player.timer);
  clearTimeout(player.sleepTimer);
  shush();
  document.querySelectorAll('.speaking, .saying').forEach((n) => n.classList.remove('speaking', 'saying'));
  $('playbar').classList.remove('on');
  $('btnListen').classList.remove('on');
  $('btnListen').textContent = '▶ Listen';
  if (wasActive) rememberPosition();   // don't overwrite a saved spot we never played
}

function skipSentence(delta) {
  if (!player.active) return;
  player.sentence = Math.max(0, Math.min(player.sentence + delta, state.narration.sentences.length - 1));
  player.run = 0;
  clearTimeout(player.timer);
  shush();
  if (!player.paused) speakStep();
  else highlightRun(state.narration.sentences[player.sentence], { part: null });
}

let positionTimer = null;
function rememberPosition() {
  if (!state.doc) return;
  prefs.listen = {
    doc: state.doc.id, section: state.sectionIndex, sentence: player.sentence, mode: state.mode,
  };
  clearTimeout(positionTimer);
  positionTimer = setTimeout(savePrefs, 600);
}

function startSleepTimer() {
  clearTimeout(player.sleepTimer);
  const minutes = Number(prefs.sleep) || 0;
  if (!minutes) return;
  player.sleepTimer = setTimeout(() => {
    stopListening();
    $('playLabel').textContent = 'Sleep timer';
  }, minutes * 60000);
}

/**
 * Called after every re-render. If the text changed while the voice was
 * talking — you moved the dial, or marked a word known — pick the sentence up
 * again from its start with the new wording.
 */
function onTextRerendered() {
  if (!player.active) return;
  const sentences = state.narration?.sentences || [];
  if (!sentences.length) { stopListening(); return; }
  $('playSeek').max = String(sentences.length - 1);
  player.sentence = Math.min(player.sentence, sentences.length - 1);
  player.run = 0;
  if (player.paused) { highlightRun(sentences[player.sentence], { part: null }); return; }
  clearTimeout(player.timer);
  shush();
  player.timer = setTimeout(speakStep, 60);
}

// ── wiring ──────────────────────────────────────────────────────────────────

function setLevel(value, { save: persist = true } = {}) {
  prefs.level = Math.max(0, Math.min(100, Math.round(value)));
  $('level').value = String(prefs.level);
  $('level').style.setProperty('--pct', prefs.level + '%');
  $('levelOut').textContent = prefs.level;
  $('stageOut').textContent = stageName(prefs.level);
  if (persist) savePrefs();
  scheduleRender();
}

$('level').addEventListener('input', (e) => setLevel(Number(e.target.value), { save: false }));
$('level').addEventListener('change', savePrefs);
$('btnAdd').onclick = () => panelAdd();
$('btnScenes').onclick = panelScenes;
$('btnDrill').onclick = () => {
  stopListening();
  state.mode = state.mode === 'drill' ? 'read' : 'drill';
  player.sentence = 0;
  player.run = 0;
  if (state.mode === 'read') reanalyze();
  render();
  window.scrollTo({ top: 0 });
};
$('btnLibrary').onclick = panelLibrary;
$('btnStats').onclick = panelStats;
$('btnExport').onclick = panelExport;
$('btnSettings').onclick = () => panelSettings();
$('panelClose').onclick = closePanel;
$('scrim').onclick = closePanel;
$('btnListen').onclick = () => (player.active ? stopListening() : listenFrom(resumePoint()));
$('playStop').onclick = stopListening;
$('playPause').onclick = () => (player.paused ? resumeListening() : pauseListening());
$('playPrev').onclick = () => skipSentence(-1);
$('playNext').onclick = () => skipSentence(1);
$('playSeek').oninput = (e) => {
  const target = Number(e.target.value);
  player.sentence = target;
  player.run = 0;
  clearTimeout(player.timer);
  shush();
  const sentence = state.narration?.sentences[target];
  if (sentence) highlightRun(sentence, { part: null });
};
$('playSeek').onchange = () => { if (player.active && !player.paused) speakStep(); };
$('rate').onchange = (e) => { prefs.rate = Number(e.target.value); savePrefs(); };
$('sleep').onchange = (e) => { prefs.sleep = Number(e.target.value); savePrefs(); if (player.active) startSleepTimer(); };

const peek = (on) => document.body.classList.toggle('peek', on);
$('btnPeek').addEventListener('pointerdown', () => peek(true));
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('btnPeek').addEventListener(ev, () => peek(false)));

document.addEventListener('click', (e) => {
  const span = e.target.closest?.('.es');
  if (span) { showPop(span); e.stopPropagation(); return; }
  if (!e.target.closest?.('#pop')) hidePop();
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') { hidePop(); closePanel(); stopListening(); }
  if (e.key === ' ' && player.active) { (player.paused ? resumeListening : pauseListening)(); e.preventDefault(); }
  if (e.key === ',' && player.active) skipSentence(-1);
  if (e.key === '.' && player.active) skipSentence(1);
  if (e.key === 'ArrowRight' && !e.metaKey) { setLevel(prefs.level + (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  if (e.key === 'ArrowLeft' && !e.metaKey) { setLevel(prefs.level - (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  if (e.key === 'p' && !e.repeat) peek(true);
});
document.addEventListener('keyup', (e) => { if (e.key === 'p') peek(false); });
window.addEventListener('scroll', () => { if (popTarget) hidePop(); }, { passive: true });
try { synth?.addEventListener?.('voiceschanged', () => {}); } catch { /* not available */ }

// ── boot ────────────────────────────────────────────────────────────────────

(async function boot() {
  try {
    document.documentElement.style.setProperty('--reader-size', prefs.readerSize + 'px');
    $('rate').value = String(prefs.rate);
    setLevel(prefs.level, { save: false });
    if (!canSpeak) $('btnListen').title = 'This browser will not let the page speak aloud';

    let doc = null;
    if (prefs.lastDoc) doc = await db.get(prefs.lastDoc).catch(() => null);
    if (!doc) doc = makeDoc({ title: SAMPLE.title, author: SAMPLE.author, text: SAMPLE.text });
    await loadDoc(doc);
  } catch (err) {
    // Whatever went wrong, say so on the page. A blank reader tells you
    // nothing, and this is the one place that can produce one.
    const reader = $('reader');
    reader.textContent = '';
    reader.append(el('h1', 'title', 'This did not start'));
    reader.append(el('p', null, String(err && err.message ? err.message : err)));
    reader.append(el('p', 'byline', 'Try reloading. If it keeps happening, open the page in its own tab rather than an embedded frame.'));
    throw err;
  }
})();
