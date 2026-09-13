// The diglot weaver: turns English text into English-with-Spanish-woven-in.
//
// Two stages on purpose:
//   analyze(text)            → slow-ish, once per document. Finds every word
//                              that *could* be Spanish and how hard it is.
//   applyLevel(analysis, o)  → fast, on every slider move. Decides which of
//                              those actually turn Spanish, and inflects them
//                              to fit the sentence around them.
// That split is what makes the slider feel instant on a whole chapter.

import { BANDS } from './lexicon.js';
import { pluralize, agree, apocopate, article as esArticle, conjugate, matchCase } from './morph.js';

// ── index ───────────────────────────────────────────────────────────────────

/** Build the lookup table. Rank is a 0–100 "difficulty" position in the list. */
export function buildIndex(bands = BANDS) {
  const byKey = new Map();
  let maxPhrase = 1;
  bands.forEach((band, b) => {
    band.forEach((entry, i) => {
      const [en, es, pos, extra] = entry.split('|');
      const key = en.toLowerCase();
      if (byKey.has(key)) return; // first band wins: earlier = easier
      const rank = ((b + (i + 0.5) / band.length) / bands.length) * 100;
      const words = key.split(' ').length;
      if (words > maxPhrase) maxPhrase = words;
      byKey.set(key, { key, en, es, pos, gender: extra === 'f' ? 'f' : 'm', rank, band: b, words });
    });
  });
  return { byKey, maxPhrase, size: byKey.size };
}

export const DEFAULT_INDEX = buildIndex();

// ── English morphology (just enough to look words up) ───────────────────────

const IRREGULAR_NOUNS = {
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose', lives: 'life', wives: 'wife', knives: 'knife',
  leaves: 'leaf', shelves: 'shelf', halves: 'half', thieves: 'thief',
  people: 'person', cities: 'city', countries: 'country',
};

const IRREGULAR_VERBS = {
  was: ['be', 'past'], were: ['be', 'past'], been: ['be', 'part'], am: ['be', 'pres1'],
  went: ['go', 'past'], gone: ['go', 'part'], goes: ['go', 'pres3'],
  had: ['have', 'past'], has: ['have', 'pres3'],
  did: ['do', 'past'], done: ['do', 'part'], does: ['do', 'pres3'],
  said: ['say', 'past'], made: ['make', 'past'], took: ['take', 'past'],
  taken: ['take', 'part'], came: ['come', 'past'], saw: ['see', 'past'],
  seen: ['see', 'part'], knew: ['know', 'past'], known: ['know', 'part'],
  gave: ['give', 'past'], given: ['give', 'part'], found: ['find', 'past'],
  thought: ['think', 'past'], told: ['tell', 'past'], became: ['become', 'past'],
  left: ['leave', 'past'], felt: ['feel', 'past'], brought: ['bring', 'past'],
  began: ['begin', 'past'], begun: ['begin', 'part'], kept: ['keep', 'past'],
  held: ['hold', 'past'], wrote: ['write', 'past'], written: ['write', 'part'],
  stood: ['stand', 'past'], heard: ['hear', 'past'], meant: ['mean', 'past'],
  met: ['meet', 'past'], ran: ['run', 'past'], paid: ['pay', 'past'],
  sat: ['sit', 'past'], spoke: ['speak', 'past'], spoken: ['speak', 'part'],
  led: ['lead', 'past'], grew: ['grow', 'past'], grown: ['grow', 'part'],
  lost: ['lose', 'past'], fell: ['fall', 'past'], sent: ['send', 'past'],
  built: ['build', 'past'], understood: ['understand', 'past'],
  drew: ['draw', 'past'], broke: ['break', 'past'], broken: ['break', 'part'],
  spent: ['spend', 'past'], rose: ['rise', 'past'], bought: ['buy', 'past'],
  wore: ['wear', 'past'], chose: ['choose', 'past'], chosen: ['choose', 'part'],
  ate: ['eat', 'past'], eaten: ['eat', 'part'], drank: ['drink', 'past'],
  slept: ['sleep', 'past'], won: ['win', 'past'], taught: ['teach', 'past'],
  sang: ['sing', 'past'], swam: ['swim', 'past'], flew: ['fly', 'past'],
  died: ['die', 'past'], drove: ['drive', 'past'], sold: ['sell', 'past'],
};

function dedouble(stem) {
  return /([bcdfgklmnprstvz])\1$/.test(stem) ? stem.slice(0, -1) : stem;
}

/**
 * Every plausible (lemma, inflection) reading of an English word, best first.
 * Inflection: {number: 'pl'|'sg', verbForm: 'inf'|'pres3'|'past'|'ger'|'part'}
 */
function readings(word) {
  const w = word.toLowerCase();
  const out = [[w, {}]];
  if (IRREGULAR_NOUNS[w]) out.push([IRREGULAR_NOUNS[w], { number: 'pl' }]);
  if (IRREGULAR_VERBS[w]) {
    const [lemma, form] = IRREGULAR_VERBS[w];
    out.push([lemma, { verbForm: form, irregular: true }]);
  }
  const sForm = { number: 'pl', verbForm: 'pres3', ambiguous: true };
  if (w.length > 4 && w.endsWith('ies')) out.push([w.slice(0, -3) + 'y', sForm]);
  if (w.length > 4 && /(ch|sh|ss|x|z|o)es$/.test(w)) out.push([w.slice(0, -2), sForm]);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.push([w.slice(0, -1), sForm]);
  if (w.length > 4 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    out.push([stem, { verbForm: 'ger' }], [stem + 'e', { verbForm: 'ger' }], [dedouble(stem), { verbForm: 'ger' }]);
  }
  if (w.length > 3 && w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    out.push([stem, { verbForm: 'past' }], [w.slice(0, -1), { verbForm: 'past' }], [dedouble(stem), { verbForm: 'past' }]);
    if (stem.endsWith('i')) out.push([stem.slice(0, -1) + 'y', { verbForm: 'past' }]);
  }
  if (w.length > 4 && w.endsWith('er')) out.push([w.slice(0, -2), { degree: 'comp' }], [w.slice(0, -1), { degree: 'comp' }]);
  if (w.length > 5 && w.endsWith('est')) out.push([w.slice(0, -3), { degree: 'sup' }], [w.slice(0, -2), { degree: 'sup' }]);
  return out;
}

// ── tokenizer ───────────────────────────────────────────────────────────────

const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/u;

/** Split into word / non-word tokens, losing nothing. */
export function tokenize(text) {
  const tokens = [];
  const re = new RegExp(WORD_RE, 'gu');
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) tokens.push({ kind: 'gap', raw: text.slice(last, m.index) });
    tokens.push({ kind: 'word', raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'gap', raw: text.slice(last) });
  return tokens;
}

const DETERMINERS = {
  the: 'definite', a: 'indefinite', an: 'indefinite',
  this: 'demonstrative', these: 'demonstrative', that: 'that', those: 'that',
};
const POSSESSIVES = { my: 'mi', your: 'tu', his: 'su', her: 'su', its: 'su', our: 'nuestro', their: 'su' };
const SUBJECTS = {
  i: 'pres1', we: 'pres1p', you: 'pres2', they: 'pres3p',
  he: 'pres3', she: 'pres3', it: 'pres3',
};
const SENTENCE_END = /[.!?][)\]"'”’\s]*$|\n\s*$/;
const CONTRACTIONS = { de: 'del', a: 'al' };
const AUXILIARIES = ['will', 'would', 'can', 'could', 'should', 'must', 'may', 'might', 'has', 'have', 'had', 'is', 'are', 'was', 'were', 'do', 'does', 'did'];

/**
 * A few function words mean different things in different slots. Rather than
 * a part-of-speech tagger, these hand-written rules cover the handful that
 * would otherwise produce nonsense. Returning null skips the swap entirely.
 */
const CONTEXT = {
  to: (ctx) => (ctx.nextIsVerb ? null : 'a'),          // infinitive marker: leave it
  that: (ctx) => (ctx.nextIsVerb ? 'que' : null),      // relative "que" vs demonstrative
  which: (ctx) => (ctx.nextIsVerb ? 'que' : 'cual'),
  who: (ctx) => (ctx.nextIsVerb ? 'que' : 'quien'),
  i: () => 'yo',                                        // never "Yo" mid-sentence
  as: (ctx) => (ctx.nextIsVerb ? null : 'como'),
  like: (ctx) => (ctx.prevIsSubject ? null : 'como'),
};
const COPULAS = ['is', 'are', 'was', 'were', 'am', 'be', 'been', 'seems', 'seem', 'seemed', 'looks', 'look', 'looked', 'feels', 'feel', 'felt', 'became', 'become', 'stays', 'stay'];

const VERBY_BEFORE = ['who', 'that', 'which', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'to', 'not', "don't", "doesn't"];
const NOUNY_BEFORE = ['the', 'a', 'an', 'this', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'of', 'in', 'on', 'at', 'for', 'with', 'many', 'some', 'few', 'all'];

/** Nudge an ambiguous word ("lives") towards the reading its neighbour implies. */
function posScore(pos, prevWord, inflection, prevIsSubject) {
  let score = 0;
  if (pos === 'v' && (VERBY_BEFORE.includes(prevWord) || AUXILIARIES.includes(prevWord))) score += 2;
  if (pos === 'n' && NOUNY_BEFORE.includes(prevWord)) score += 2;
  if (pos === 'v' && NOUNY_BEFORE.includes(prevWord)) score -= 2;
  if (pos === 'n' && VERBY_BEFORE.includes(prevWord)) score -= 1;
  // "her neighbours thought" is a verb; "she had a thought" is a noun. An
  // irregular past form straight after a subject is almost always the verb.
  if (pos === 'v' && inflection?.irregular && prevIsSubject) score += 2.5;
  return score;
}

/** Does this word read as a noun in its own right (not as an inflected verb)? */
function nounReading(word, index) {
  for (const [lemma, inf] of readings(word)) {
    if (inf.verbForm && !inf.ambiguous) continue;
    const entry = index.byKey.get(lemma);
    if (!entry) continue;
    if (entry.pos !== 'n') return null;
    return { gender: entry.gender, plural: inf.number === 'pl' || (inf.ambiguous && /s$/.test(word)) };
  }
  return null;
}

/** Could this word be the subject of the verb that follows it? */
function subjectish(tokens, i, index) {
  if (i == null || i < 0 || tokens[i].kind !== 'word') return false;
  const word = tokens[i].raw.toLowerCase();
  if (SUBJECTS[word]) return true;
  if (/^\p{Lu}/u.test(tokens[i].raw) && !index.byKey.has(word)) return true; // a name
  return !!nounReading(word, index);
}

// ── analysis ────────────────────────────────────────────────────────────────

/**
 * Find every swappable span in the text. Returns a structure that applyLevel()
 * can render at any difficulty without re-scanning.
 */
export function analyze(text, index = DEFAULT_INDEX) {
  const tokens = tokenize(text);
  const wordPositions = [];
  tokens.forEach((t, i) => { if (t.kind === 'word') wordPositions.push(i); });

  // Sentence starts: a word is sentence-initial if all that precedes it in the
  // gap is terminal punctuation (so capitals there aren't proper nouns).
  let atStart = true;
  let atLineStart = true;
  tokens.forEach((t, i) => {
    if (t.kind === 'gap') {
      if (SENTENCE_END.test(t.raw)) atStart = true;
      if (/\n/.test(t.raw)) atLineStart = true;
      return;
    }
    t.sentenceStart = atStart;
    // "Waiter: ..." — a dialogue label, not something to translate.
    if (atLineStart) {
      const after = tokens[i + 1];
      if (after && after.kind === 'gap' && /^\s*:/.test(after.raw)) t.speakerLabel = true;
    }
    atStart = false;
    atLineStart = false;
  });

  const candidates = [];
  const consumed = new Set();
  for (let wi = 0; wi < wordPositions.length; wi++) {
    const ti = wordPositions[wi];
    if (consumed.has(ti)) continue;
    const token = tokens[ti];
    if (token.speakerLabel) continue;

    // Phrases first (longest match wins), then the single word.
    let hit = null;
    for (let n = Math.min(index.maxPhrase, wordPositions.length - wi); n >= 2 && !hit; n--) {
      const span = wordPositions.slice(wi, wi + n);
      // Words of a phrase may be separated by spaces or a comma — "the bill,
      // please" is the same phrase as "the bill please", and its Spanish
      // brings its own punctuation.
      const glueOk = span.slice(1).every((p, k) => {
        for (let j = span[k] + 1; j < p; j++) if (!/^[\s,]+$/.test(tokens[j].raw)) return false;
        return true;
      });
      if (!glueOk) continue;
      const key = span.map((p) => tokens[p].raw.toLowerCase()).join(' ');
      const entry = index.byKey.get(key);
      if (entry) hit = { entry, span, inflection: {} };
    }
    if (!hit) {
      // Proper nouns stay English — a capital mid-sentence is a name.
      const isCapMidSentence = !token.sentenceStart && /^\p{Lu}/u.test(token.raw)
        && token.raw.toLowerCase() !== 'i';
      if (isCapMidSentence) continue;
      const prevIdx = prevWordIndex(tokens, ti);
      const prevWord = prevIdx != null ? tokens[prevIdx].raw.toLowerCase() : '';
      const prevSubjectish = subjectish(tokens, prevIdx, index);
      const options = [];
      readings(token.raw).forEach(([lemma, raw], order) => {
        const entry = index.byKey.get(lemma);
        if (!entry || entry.words > 1) return;
        let inflection = raw;
        if (raw.ambiguous) {
          // "books" is a plural noun; "walks" is a verb. The entry knows which.
          if (entry.pos === 'v') inflection = { verbForm: 'pres3' };
          else if (entry.pos === 'n') inflection = { number: 'pl' };
          else return;
        } else {
          if (inflection.verbForm && entry.pos !== 'v') return;
          if (inflection.degree && entry.pos !== 'adj' && entry.pos !== 'adv') return;
        }
        options.push({
          entry, span: [ti], inflection,
          score: posScore(entry.pos, prevWord, inflection, prevSubjectish) - order * 0.1,
        });
      });
      if (options.length) {
        options.sort((a, b) => b.score - a.score);
        hit = options[0];
      }
    }
    if (!hit) continue;
    hit.span.forEach((p) => consumed.add(p));
    wi += hit.span.length - 1;
    candidates.push({ ...hit, tokenIndex: ti, id: candidates.length });
    tokens[ti].candidate = candidates[candidates.length - 1];
  }

  const wordCount = wordPositions.length;
  return { text, tokens, candidates, wordCount, index };
}

// ── rendering at a level ────────────────────────────────────────────────────

export const DEFAULTS = {
  level: 25,
  articles: true,      // "the house" → "la casa" once you're past articleLevel
  articleLevel: 35,
  known: null,         // Set of keys always woven, whatever the slider says
  blocked: null,       // Set of keys never woven
  firstHint: false,    // gloss the first appearance of each Spanish word
};

/**
 * Decide which candidates fire at this level and inflect them in context.
 * Returns render nodes plus stats.
 */
export function applyLevel(analysis, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { tokens, candidates } = analysis;
  const known = opts.known || new Set();
  const blocked = opts.blocked || new Set();

  // 1. which candidates fire
  const firing = new Map(); // tokenIndex -> candidate
  for (const c of candidates) {
    const key = c.entry.key;
    if (blocked.has(key)) continue;
    if (!known.has(key) && c.entry.rank > opts.level) continue;
    firing.set(c.tokenIndex, c);
  }

  // 2. inflect, with a look at the neighbours
  const decided = new Map();
  for (const c of firing.values()) {
    const out = inflect(c, analysis, firing, opts);
    if (out) decided.set(c.tokenIndex, out);
    else firing.delete(c.tokenIndex);
  }

  // 3. determiners: "the casa" reads better as "la casa". This also repairs
  //    determiners that fired on their own (band 9), which don't know their
  //    noun's gender until now.
  const absorbed = new Set();
  if (opts.articles) {
    for (const [ti, out] of [...decided]) {
      if (out.pos !== 'n') continue;
      const prev = prevWordIndex(tokens, ti, true);
      if (prev == null || absorbed.has(prev)) continue;
      const prevWord = tokens[prev].raw.toLowerCase();
      const detFired = firing.has(prev);
      // Below articleLevel we only fix determiners that fired by themselves.
      if (!detFired && opts.level < opts.articleLevel) continue;
      let esDet = null;
      if (DETERMINERS[prevWord]) esDet = esArticle(DETERMINERS[prevWord], out.gender, out.plural, out.es);
      else if (POSSESSIVES[prevWord]) esDet = out.plural ? pluralize(POSSESSIVES[prevWord]) : POSSESSIVES[prevWord];
      if (!esDet) continue;
      absorbed.add(prev);
      const rank = detFired ? firing.get(prev).entry.rank : out.rank;
      decided.set(prev, {
        es: matchCase(esDet, tokens[prev].raw), en: tokens[prev].raw, pos: 'det',
        key: prevWord, rank, gloss: esDet, gender: out.gender, plural: out.plural,
      });
      if (detFired) firing.delete(prev);
    }
  }

  // 4. build render nodes
  const nodes = [];
  const seen = new Set();
  let swapped = 0;
  const spanishWords = new Set();
  let lastSwapNode = null;
  let lastSwapGap = null;
  let stripColon = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const out = decided.get(i);
    if (t.speakerLabel) {
      nodes.push({ kind: 'plain', text: t.raw + ':', speaker: t.raw });
      stripColon = true;
      lastSwapNode = null;
      lastSwapGap = null;
      continue;
    }
    if (!out) {
      let text = t.raw;
      if (stripColon && t.kind === 'gap') { text = text.replace(/^\s*:/, ''); stripColon = false; }
      const node = { kind: t.kind === 'gap' ? 'gap' : 'plain', text };
      nodes.push(node);
      if (t.kind === 'word') lastSwapNode = null;
      else if (/^\s+$/.test(text)) lastSwapGap = node;
      else { lastSwapNode = null; lastSwapGap = null; }
      continue;
    }
    const c = firing.get(i);
    const span = c ? c.span : [i];
    const enText = span.map((p) => tokens[p].raw).join(' ');
    const first = !seen.has(out.key);
    seen.add(out.key);
    if (out.pos !== 'det') { swapped += span.length; spanishWords.add(out.key); }
    const node = {
      kind: 'swap', text: out.es, en: enText, key: out.key, pos: out.pos,
      rank: Math.round(out.rank), gloss: out.gloss, first,
      hint: opts.firstHint && first ? enText : null,
    };
    // de + el = del, a + el = al
    const tail = lastSwapNode ? lastSwapNode.text.toLowerCase().split(' ').pop() : '';
    const contraction = lastSwapNode && lastSwapGap === nodes[nodes.length - 1]
      && CONTRACTIONS[tail] && node.text.toLowerCase() === 'el';
    if (contraction) {
      const head = lastSwapNode.text.split(' ').slice(0, -1);
      lastSwapNode.text = [...head, matchCase(CONTRACTIONS[tail], lastSwapNode.text.split(' ').pop())].join(' ');
      lastSwapNode.en += ' ' + enText;
      nodes.pop(); // the space between them
    } else {
      nodes.push(node);
      lastSwapNode = node;
    }
    lastSwapGap = null;
    i = span[span.length - 1]; // skip the rest of a phrase span
  }

  return {
    nodes,
    stats: {
      words: analysis.wordCount,
      swapped,
      ratio: analysis.wordCount ? swapped / analysis.wordCount : 0,
      uniqueSpanish: spanishWords.size,
      candidates: candidates.length,
      headroom: analysis.wordCount ? candidates.length / analysis.wordCount : 0,
    },
  };
}

function prevWordIndex(tokens, i, skipAdjectives = false) {
  let j = i - 1;
  for (; j >= 0; j--) {
    if (tokens[j].kind === 'word') break;
    if (!/^[\s"'“‘(]*$/.test(tokens[j].raw)) return null; // punctuation breaks the phrase
  }
  if (j < 0) return null;
  if (skipAdjectives) {
    // "the big red casa": walk back over modifiers to reach the determiner.
    let k = j;
    let hops = 0;
    while (k >= 0 && hops < 3) {
      const cand = tokens[k].candidate;
      const isModifier = cand && (cand.entry.pos === 'adj' || cand.entry.pos === 'adv');
      if (!isModifier) break;
      const back = prevWordIndex(tokens, k);
      if (back == null) break;
      k = back;
      hops++;
    }
    return k;
  }
  return j;
}

function nextWords(tokens, i, n) {
  const out = [];
  for (let j = i + 1; j < tokens.length && out.length < n; j++) {
    if (tokens[j].kind === 'word') out.push(j);
    else if (!/^[\s-]*$/.test(tokens[j].raw)) break;
  }
  return out;
}

/** Put a candidate's Spanish into the right shape for its English slot. */
function inflect(c, analysis, firing, opts) {
  const { tokens, index } = analysis;
  const { entry, inflection } = c;
  const ti = c.tokenIndex;
  const model = tokens[ti].raw;
  let es = entry.es;
  let plural = inflection.number === 'pl';
  let gender = entry.gender;

  const override = CONTEXT[entry.key];
  if (override) {
    const next = nextWords(tokens, c.span[c.span.length - 1], 1)[0];
    const nextWord = next != null ? tokens[next].raw.toLowerCase() : '';
    const prev = prevWordIndex(tokens, ti);
    const ctx = {
      nextIsVerb: !!nextWord && (AUXILIARIES.includes(nextWord) || isVerbWord(nextWord, index)),
      prevIsSubject: prev != null && SUBJECTS[tokens[prev].raw.toLowerCase()] !== undefined,
    };
    const forced = override(ctx);
    if (forced == null) return null;
    es = forced;
    return { es: tokens[ti].sentenceStart ? matchCase(es, 'X') : es, pos: entry.pos, key: entry.key, rank: entry.rank, gloss: es, gender, plural };
  }

  if (entry.pos === 'n') {
    if (plural) es = pluralize(es);
  } else if (entry.pos === 'adj') {
    const head = headNoun(tokens, ti, index, firing) || subjectNoun(tokens, ti, index, firing);
    if (head) { gender = head.gender; plural = head.plural; }
    else if (inflection.number === 'pl') plural = true;
    es = agree(es, gender, plural);
    if (head && head.attributive) es = apocopate(es, gender, plural);
    if (inflection.degree === 'comp') es = 'más ' + es;
    if (inflection.degree === 'sup') es = 'el más ' + es;
  } else if (entry.pos === 'v') {
    es = conjugate(es, verbForm(tokens, ti, inflection, index));
  } else if (entry.pos === 'num' && entry.key === 'one') {
    const head = headNoun(tokens, ti, index, firing);
    if (head) es = head.plural ? 'unos' : esArticle('indefinite', head.gender, false, '');
  } else if (entry.pos === 'det' || entry.pos === 'pron') {
    // leave as listed
  }

  return {
    es: matchCase(es, model), pos: entry.pos, key: entry.key, rank: entry.rank,
    gloss: entry.es, gender, plural,
  };
}

/**
 * The noun an attributive adjective modifies: "the old woman" → woman.
 * Only looks across other modifiers — a conjunction or preposition ends the
 * noun phrase, so "happy because the water" never agrees with "water".
 */
function headNoun(tokens, ti, index, firing) {
  for (const j of nextWords(tokens, ti, 3)) {
    const word = tokens[j].raw.toLowerCase();
    const fired = firing.get(j);
    if (fired && fired.entry.pos === 'n') {
      return { gender: fired.entry.gender, plural: fired.inflection.number === 'pl', attributive: true };
    }
    const asNoun = nounReading(word, index);
    if (asNoun) return { ...asNoun, attributive: true };
    let modifier = false;
    for (const [lemma, inf] of readings(word)) {
      const e = index.byKey.get(lemma);
      if (!e) continue;
      void inf;
      if (e.pos === 'adj' || e.pos === 'adv' || e.pos === 'det') { modifier = true; break; }
      return null; // a verb/preposition/conjunction ends the noun phrase
    }
    if (!modifier && !DETERMINERS[word] && !POSSESSIVES[word]) return null; // unknown word: don't guess
  }
  return null;
}

function isVerbWord(word, index) {
  for (const [lemma] of readings(word)) {
    const e = index.byKey.get(lemma);
    if (e && e.pos === 'v') return true;
  }
  return false;
}

/** For a predicate adjective ("the children were happy"), find the subject. */
function subjectNoun(tokens, ti, index, firing) {
  let sawCopula = false;
  let steps = 0;
  for (let j = ti - 1; j >= 0 && steps < 6; j--) {
    const t = tokens[j];
    if (t.kind !== 'word') {
      if (/[.!?;:]/.test(t.raw)) return null;
      continue;
    }
    steps++;
    const w = t.raw.toLowerCase();
    if (COPULAS.includes(w)) { sawCopula = true; continue; }
    if (t.candidate && t.candidate.entry.pos === 'v') return null; // an ordinary verb, not a copula
    if (!sawCopula) continue;
    if (w === 'they' || w === 'we') return { gender: 'm', plural: true };
    if (w === 'she') return { gender: 'f', plural: false };
    if (w === 'he' || w === 'it') return { gender: 'm', plural: false };
    const settled = t.candidate?.entry;
    if (settled && settled.pos !== 'n') continue;
    const asNoun = settled
      ? { gender: settled.gender, plural: t.candidate.inflection.number === 'pl' }
      : nounReading(w, index);
    if (asNoun) return asNoun;
  }
  return null;
}

const PREPOSITIONS = ['of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'after', 'before', 'to', 'into', 'over', 'under', 'between', 'through', 'during', 'without'];

/**
 * The subject of the verb at `ti`, skipping over prepositional phrases so that
 * "the plans of the company changed" agrees with plans, not company.
 */
function subject(tokens, ti, index) {
  let steps = 0;
  for (let j = ti - 1; j >= 0 && steps < 8; j--) {
    const t = tokens[j];
    if (t.kind !== 'word') { if (/[.!?;]/.test(t.raw)) return null; continue; }
    steps++;
    const w = t.raw.toLowerCase();
    if (SUBJECTS[w]) return { person: SUBJECTS[w], plural: w === 'we' || w === 'they' };
    // analyze() already settled this word's part of speech in context; trust it
    // over a fresh guess ("lives" after "who" is a verb, not lots of lives).
    const settled = t.candidate?.entry;
    if (settled && settled.pos !== 'n') continue;
    const asNoun = settled
      ? { gender: settled.gender, plural: t.candidate.inflection.number === 'pl' }
      : nounReading(w, index);
    const isNoun = !!asNoun;
    let plural = asNoun?.plural || false;
    // An unknown capitalised word is a name: treat it as a singular subject.
    if (!isNoun && /^\p{Lu}/u.test(t.raw) && !index.byKey.has(w)) {
      const pl = compound(tokens, j, ti, index);
      return { person: pl ? 'pres3p' : 'pres3', plural: pl };
    }
    if (!isNoun) continue;
    // Walk to the head of this noun phrase and see what introduces it.
    let k = j;
    for (let m = j - 1; m >= 0; m--) {
      if (tokens[m].kind !== 'word') { if (!/^[\s,]*$/.test(tokens[m].raw)) break; continue; }
      const mw = tokens[m].raw.toLowerCase();
      if (DETERMINERS[mw] || POSSESSIVES[mw] || isAdjectiveWord(mw, index)) { k = m; continue; }
      break;
    }
    const before = prevWordIndex(tokens, k);
    const beforeWord = before != null ? tokens[before].raw.toLowerCase() : '';
    if (PREPOSITIONS.includes(beforeWord)) { j = before; continue; } // inside a prepositional phrase
    if (compound(tokens, j, ti, index)) plural = true;
    return { person: plural ? 'pres3p' : 'pres3', plural };
  }
  return null;
}

/**
 * A conjoined subject is plural — but only when the "and" really joins two noun
 * phrases. "said good morning and never asked" joins two verbs, and that one
 * stays singular.
 */
function compound(tokens, from, to, index) {
  const nounish = (j) => {
    if (j == null || j < 0 || tokens[j].kind !== 'word') return false;
    const w = tokens[j].raw.toLowerCase();
    if (SUBJECTS[w]) return true;
    if (/^\p{Lu}/u.test(tokens[j].raw) && !index.byKey.has(w)) return true; // a name
    for (const [lemma] of readings(w)) {
      const e = index.byKey.get(lemma);
      if (e) return e.pos === 'n';
    }
    return false;
  };
  const joinsNouns = (m) => {
    const before = prevWordIndex(tokens, m);
    const after = nextWords(tokens, m, 3).find((j) => {
      const w = tokens[j].raw.toLowerCase();
      return !DETERMINERS[w] && !POSSESSIVES[w] && !isAdjectiveWord(w, index);
    });
    return nounish(before) && nounish(after);
  };
  for (let m = from + 1; m < to; m++) {
    if (tokens[m].kind === 'word' && tokens[m].raw.toLowerCase() === 'and' && joinsNouns(m)) return true;
  }
  let seen = 0;
  for (let m = from - 1; m >= 0 && seen < 3; m--) {
    if (tokens[m].kind !== 'word') { if (/[.!?;]/.test(tokens[m].raw)) break; continue; }
    seen++;
    if (tokens[m].raw.toLowerCase() === 'and' && joinsNouns(m)) return true;
  }
  return false;
}

function isAdjectiveWord(word, index) {
  const e = index.byKey.get(word);
  return !!e && (e.pos === 'adj' || e.pos === 'adv');
}

/** Which conjugated form fits: look at auxiliaries and the subject. */
function verbForm(tokens, ti, inflection, index) {
  if (inflection.verbForm === 'ger') return 'ger';
  if (inflection.verbForm === 'part') return 'part';
  const prev = prevWordIndex(tokens, ti);
  const prevWord = prev != null ? tokens[prev].raw.toLowerCase() : '';
  if (['have', 'has', 'had', 'been', 'having'].includes(prevWord)) return 'part';
  if (inflection.verbForm === 'past') {
    const subj = subject(tokens, ti, index);
    return subj && subj.plural ? 'pret3p' : 'pret3';
  }
  if (['to', 'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might', "don't", 'not'].includes(prevWord)) return 'inf';
  if (['have', 'has', 'had', 'been'].includes(prevWord)) return 'part';
  if (['is', 'are', 'was', 'were', 'am'].includes(prevWord)) return 'ger';
  if (inflection.verbForm === 'pres3') return 'pres3';
  if (SUBJECTS[prevWord]) return SUBJECTS[prevWord];
  const subj = subject(tokens, ti, index);
  if (subj) return subj.person;
  return 'pres3';
}

/** Convenience: analyze + apply in one call. */
export function weave(text, options = {}, index = DEFAULT_INDEX) {
  return applyLevel(analyze(text, index), options);
}

/** Flatten render nodes back to plain text (for export / TTS). */
export function toText(nodes, { hints = false } = {}) {
  return nodes.map((n) => {
    if (n.kind === 'swap') return hints && n.hint ? `${n.text} (${n.hint})` : n.text;
    return n.text;
  }).join('');
}
