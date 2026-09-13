// Diglot — the browser side. Nothing here talks to a server except the page
// fetcher and (only if you supply a key) the Anthropic API.

import { analyze, applyLevel, buildIndex, DEFAULT_INDEX } from '../src/diglot/weave.js';
import { BANDS } from '../src/diglot/lexicon.js';
import { fetchArticle, cleanText, splitIntoSections, wordCount, guessTitle } from '../src/diglot/ingest.js';
import { readEpub, buildEpub } from '../src/diglot/epub.js';
import { alignDocument, writeArticle, testKey, entriesToBands, MODELS } from '../src/diglot/llm.js';

// ── storage ─────────────────────────────────────────────────────────────────

const PREF_KEY = 'diglot.prefs.v1';
const VOCAB_KEY = 'diglot.vocab.v1';

const defaultPrefs = {
  level: 25, articles: true, firstHint: false, readerSize: 19,
  apiKey: '', model: MODELS[0].id, voiceEs: '', voiceEn: '', rate: 1, lastDoc: null,
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
  sentences: [],      // for read-aloud
  speaking: false,
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

function render() {
  const reader = $('reader');
  reader.textContent = '';
  state.sentences = [];
  if (!state.analysis) {
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

  // Build paragraphs, and inside them sentence spans (so read-aloud can follow).
  let paragraph = el('p');
  let sentence = el('span', 'sentence');
  let sentenceRuns = [];

  const closeSentence = () => {
    if (!sentence.hasChildNodes()) return;
    const idx = state.sentences.length;
    sentence.dataset.s = String(idx);
    state.sentences.push({ el: sentence, runs: compactRuns(sentenceRuns) });
    paragraph.append(sentence);
    sentence = el('span', 'sentence');
    sentenceRuns = [];
  };
  const closeParagraph = () => {
    closeSentence();
    if (paragraph.hasChildNodes()) reader.append(paragraph);
    paragraph = el('p');
  };

  for (const node of result.nodes) {
    if (node.kind === 'swap') {
      const span = el('span', vocab.known.has(node.key) ? 'es known' : 'es', node.text);
      span.dataset.en = node.en;
      span.dataset.key = node.key;
      span.dataset.rank = node.rank;
      span.dataset.pos = node.pos;
      if (node.hint) {
        span.append(el('span', 'hint', ` (${node.hint})`));
      }
      sentence.append(span);
      sentenceRuns.push({ lang: 'es', text: node.text });
      continue;
    }
    // plain text or whitespace: split on blank lines into paragraphs
    const pieces = node.text.split(/\n{2,}/);
    pieces.forEach((piece, i) => {
      if (i > 0) closeParagraph();
      if (!piece) return;
      const chunks = piece.split(/(?<=[.!?…])(\s+)/); // keep sentences apart
      chunks.forEach((chunk) => {
        if (!chunk) return;
        sentence.append(document.createTextNode(chunk.replace(/\n/g, ' ')));
        sentenceRuns.push({ lang: 'en', text: chunk.replace(/\n/g, ' ') });
        if (/[.!?…]\s*$/.test(chunk) || /^\s+$/.test(chunk) && /[.!?…]\s*$/.test(sentence.textContent)) {
          if (/[.!?…]["'”’)]?\s*$/.test(sentence.textContent)) closeSentence();
        }
      });
    });
  }
  closeParagraph();

  // record what the reader has now met
  for (const node of result.nodes) {
    if (node.kind === 'swap' && node.first && node.pos !== 'det') {
      vocab.met[node.key] = (vocab.met[node.key] || 0) + 1;
    }
  }
  saveVocabThrottled();

  $('actualOut').textContent = Math.round(result.stats.ratio * 100);
  $('stageOut').textContent = stageName(prefs.level);
  renderSectionNav();
}

function compactRuns(runs) {
  const out = [];
  for (const run of runs) {
    if (!run.text.trim()) { if (out.length) out[out.length - 1].text += run.text; continue; }
    const last = out[out.length - 1];
    if (last && last.lang === run.lang) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
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

function gotoSection(i) {
  stopSpeaking();
  state.sectionIndex = Math.max(0, Math.min(i, state.doc.sections.length - 1));
  state.doc.position = state.sectionIndex;
  db.put(state.doc).catch(() => {});
  reanalyze();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── loading documents ───────────────────────────────────────────────────────

async function loadDoc(doc, { persist = true } = {}) {
  stopSpeaking();
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
      ['paste', 'Paste'], ['url', 'Web page'], ['topic', 'Write me one'], ['file', 'Book / file'],
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
      ({ paste: paneP, url: paneU, topic: paneT, file: paneF })[active](pane, status);
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

    const paneT = (host) => {
      const input = el('input');
      input.type = 'text';
      input.placeholder = 'e.g. how sourdough works, or the history of Wexford harbour';
      const length = el('select');
      [['250', 'Short — 250 words'], ['400', 'Medium — 400 words'], ['700', 'Long — 700 words']]
        .forEach(([v, l]) => { const o = el('option', null, l); o.value = v; length.append(o); });
      length.value = '400';
      const go = el('button', 'btn primary', 'Write it');
      go.onclick = async () => {
        if (!prefs.apiKey) { fail(status, 'This one needs an Anthropic API key — add it in Settings.'); return; }
        const topic = input.value.trim();
        if (!topic) { fail(status, 'What should it be about?'); return; }
        busy(status, 'Writing…');
        try {
          const article = await writeArticle(topic, {
            apiKey: prefs.apiKey, model: prefs.model, words: Number(length.value),
          });
          const doc = makeDoc({ title: article.title, text: article.text, source: 'written for you' });
          await loadDoc(doc);
          busy(status, 'Aligning the vocabulary…');
          await enrich(doc, status);
          closePanel();
        } catch (err) { fail(status, err.message); }
      };
      host.append(
        field('Topic', input, prefs.apiKey ? 'Claude writes an original article, then aligns its vocabulary so the whole thing can go Spanish.' : 'Needs an Anthropic API key (Settings).'),
        field('Length', length), go, status,
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
    body.append(checkbox('Whole document, not just this part', options.whole, (v) => { options.whole = v; }));

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
  });
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

    const voices = speechSynthesis.getVoices();
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
      es.onchange = () => { prefs.voiceEs = es.value; savePrefs(); };
      en.onchange = () => { prefs.voiceEn = en.value; savePrefs(); };
      body.append(field('Spanish voice', es), field('English voice', en));
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
  row.append(say, know, block);
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

// ── speech ──────────────────────────────────────────────────────────────────

let speechQueue = [];
let speechAt = 0;

function pickVoice(lang) {
  const voices = speechSynthesis.getVoices();
  const wanted = lang === 'es' ? prefs.voiceEs : prefs.voiceEn;
  return voices.find((v) => v.name === wanted)
    || voices.find((v) => v.lang.toLowerCase().startsWith(lang === 'es' ? 'es' : 'en'))
    || null;
}

function speakOne(text) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = pickVoice('es');
  utterance.lang = utterance.voice?.lang || 'es-ES';
  utterance.rate = Number(prefs.rate) || 1;
  speechSynthesis.speak(utterance);
}

function startSpeaking(from = 0) {
  if (!state.sentences.length) return;
  speechQueue = state.sentences;
  speechAt = from;
  state.speaking = true;
  $('playbar').classList.add('on');
  $('btnListen').classList.add('on');
  speakNext();
}

function speakNext() {
  document.querySelectorAll('.sentence.speaking').forEach((n) => n.classList.remove('speaking'));
  if (!state.speaking || speechAt >= speechQueue.length) { stopSpeaking(); return; }
  const sentence = speechQueue[speechAt];
  sentence.el.classList.add('speaking');
  const box = sentence.el.getBoundingClientRect();
  if (box.top < 60 || box.bottom > window.innerHeight - 100) {
    sentence.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  $('playLabel').textContent = `${speechAt + 1} / ${speechQueue.length}`;

  const runs = sentence.runs.filter((r) => r.text.trim());
  if (!runs.length) { speechAt++; speakNext(); return; }
  let runAt = 0;
  const sayRun = () => {
    if (!state.speaking) return;
    if (runAt >= runs.length) { speechAt++; speakNext(); return; }
    const run = runs[runAt++];
    const utterance = new SpeechSynthesisUtterance(run.text);
    utterance.voice = pickVoice(run.lang);
    utterance.lang = utterance.voice?.lang || (run.lang === 'es' ? 'es-ES' : 'en-GB');
    utterance.rate = Number(prefs.rate) || 1;
    utterance.onend = sayRun;
    utterance.onerror = sayRun;
    speechSynthesis.speak(utterance);
  };
  sayRun();
}

function stopSpeaking() {
  state.speaking = false;
  speechSynthesis.cancel();
  document.querySelectorAll('.sentence.speaking').forEach((n) => n.classList.remove('speaking'));
  $('playbar').classList.remove('on');
  $('btnListen').classList.remove('on');
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
$('btnLibrary').onclick = panelLibrary;
$('btnStats').onclick = panelStats;
$('btnExport').onclick = panelExport;
$('btnSettings').onclick = () => panelSettings();
$('panelClose').onclick = closePanel;
$('scrim').onclick = closePanel;
$('btnListen').onclick = () => (state.speaking ? stopSpeaking() : startSpeaking(0));
$('playStop').onclick = stopSpeaking;
$('playPause').onclick = () => {
  if (speechSynthesis.paused) { speechSynthesis.resume(); $('playPause').textContent = 'Pause'; }
  else { speechSynthesis.pause(); $('playPause').textContent = 'Resume'; }
};
$('rate').onchange = (e) => { prefs.rate = Number(e.target.value); savePrefs(); };

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
  if (e.key === 'Escape') { hidePop(); closePanel(); stopSpeaking(); }
  if (e.key === 'ArrowRight' && !e.metaKey) { setLevel(prefs.level + (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  if (e.key === 'ArrowLeft' && !e.metaKey) { setLevel(prefs.level - (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  if (e.key === 'p' && !e.repeat) peek(true);
});
document.addEventListener('keyup', (e) => { if (e.key === 'p') peek(false); });
window.addEventListener('scroll', () => { if (popTarget) hidePop(); }, { passive: true });
speechSynthesis.addEventListener?.('voiceschanged', () => {});

// ── boot ────────────────────────────────────────────────────────────────────

(async function boot() {
  document.documentElement.style.setProperty('--reader-size', prefs.readerSize + 'px');
  $('rate').value = String(prefs.rate);
  setLevel(prefs.level, { save: false });

  let doc = null;
  if (prefs.lastDoc) doc = await db.get(prefs.lastDoc).catch(() => null);
  if (!doc) doc = makeDoc({ title: SAMPLE.title, author: SAMPLE.author, text: SAMPLE.text });
  await loadDoc(doc);
})();
