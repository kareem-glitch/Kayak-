// Turning a woven page into something you can listen to.
//
// Reading and listening want different things. On the page you can hover a
// word you don't know; in your ears it has gone by. So the narration adds two
// things the page doesn't need: a spoken gloss the first time each Spanish
// word appears, and control over the silences — before a Spanish word, after
// it, between sentences.
//
// buildNarration() is the single source of truth for how the text divides into
// sentences. The reader renders from it too, so what you see highlighted is
// exactly what is being said.

export const NARRATION_DEFAULTS = {
  echo: 'first',      // 'none' | 'first' | 'always' — speak the English gloss
  wordGap: 0,         // ms after each Spanish word (raise it to shadow aloud)
  glossGap: 90,       // ms around a spoken gloss
  sentenceGap: 240,
  paragraphGap: 520,
};

// "Dr. Ramos" is not the end of a sentence.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'mt', 'jr', 'sr', 'vs', 'etc', 'no',
  'fig', 'ave', 'rd', 'inc', 'ltd', 'co', 'approx', 'dept', 'univ', 'est',
]);

const SENTENCE_BOUNDARY = /([.!?…]+["'”’)\]]*)(\s+|$)/g;

function endsSentence(before) {
  const trailing = before.match(/(\S+)$/);
  if (!trailing) return true;
  const word = trailing[1].replace(/[^\p{L}]/gu, '').toLowerCase();
  if (ABBREVIATIONS.has(word)) return false;
  if (word.length === 1 && /\p{Lu}/u.test(trailing[1])) return false; // an initial
  return true;
}

/**
 * Split the rendered nodes into sentences, each with the parts to draw and the
 * runs to speak.
 *
 * A part is what goes on the page: {type:'text'} or {type:'swap'}.
 * A run is what goes to the voice: {lang, text, kind, part, gapAfter}.
 */
export function buildNarration(nodes, options = {}) {
  const opts = { ...NARRATION_DEFAULTS, ...options };
  const sentences = [];
  let parts = [];
  let paragraphStart = true;
  // The weaver emits one node per word, so a full stop and the word before it
  // land in different nodes. Keep a short tail of what has already been said
  // so "Dr." can still be recognised as an abbreviation.
  let tail = '';
  let speaker = null;
  const remember = (text) => { tail = (tail + text).slice(-40); };

  const flush = (endsParagraph = false) => {
    const meaningful = parts.some((p) => p.type === 'swap' || p.text.trim());
    if (meaningful) {
      sentences.push({ index: sentences.length, parts, paragraphStart, endsParagraph, speaker });
      paragraphStart = false;
    } else if (parts.length && sentences.length) {
      // whitespace only: keep it on the previous sentence so nothing is lost
      sentences[sentences.length - 1].parts.push(...parts);
    }
    parts = [];
    if (endsParagraph) paragraphStart = true;
  };

  for (const node of nodes) {
    if (node.kind === 'swap') {
      parts.push({ type: 'swap', node });
      remember(node.text);
      continue;
    }
    if (node.speaker) {
      // "Waiter:" — drawn on the page, never spoken; it changes the voice.
      flush(true);
      speaker = node.speaker;
      parts.push({ type: 'speaker', text: node.text, speaker });
      tail = '';
      continue;
    }
    const text = node.text;
    // paragraph breaks first, then sentence ends inside each piece
    const pieces = text.split(/\n{2,}/);
    pieces.forEach((piece, pieceIndex) => {
      if (pieceIndex > 0) flush(true);
      if (!piece) return;
      let cursor = 0;
      SENTENCE_BOUNDARY.lastIndex = 0;
      let match;
      while ((match = SENTENCE_BOUNDARY.exec(piece)) !== null) {
        const end = match.index + match[1].length;
        if (!endsSentence(tail + piece.slice(cursor, match.index))) continue;
        const chunk = piece.slice(cursor, end).replace(/\n/g, ' ');
        parts.push({ type: 'text', text: chunk });
        remember(chunk);
        cursor = end;
        flush(false);
      }
      if (cursor < piece.length) {
        const chunk = piece.slice(cursor).replace(/\n/g, ' ');
        parts.push({ type: 'text', text: chunk });
        remember(chunk);
      }
    });
  }
  flush(true);

  for (const sentence of sentences) sentence.runs = buildRuns(sentence, opts);
  return {
    sentences,
    stats: {
      sentences: sentences.length,
      spanish: sentences.reduce((n, s) => n + s.runs.filter((r) => r.kind === 'word').length, 0),
      glosses: sentences.reduce((n, s) => n + s.runs.filter((r) => r.kind === 'gloss').length, 0),
    },
  };
}

function buildRuns(sentence, opts) {
  const runs = [];
  const pushText = (text) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.kind === 'text' && !last.gapAfter) last.text += text;
    else runs.push({ lang: 'en', kind: 'text', text, gapAfter: 0 });
  };

  sentence.parts.forEach((part, partIndex) => {
    if (part.type === 'speaker') return;      // shown, not said
    if (part.type === 'text') { pushText(part.text); return; }
    const node = part.node;
    // A shadowing gap belongs after a word worth repeating, not between an
    // article and its noun ("la … casa").
    const gap = node.pos === 'det' ? 0 : opts.wordGap;
    runs.push({ lang: 'es', kind: 'word', text: node.text, part: partIndex, gapAfter: gap });

    const wantsGloss = opts.echo === 'always' || (opts.echo === 'first' && node.first);
    const worthGlossing = node.pos !== 'det' && node.en
      && node.en.toLowerCase() !== node.text.toLowerCase();
    if (wantsGloss && worthGlossing) {
      runs[runs.length - 1].gapAfter = Math.max(runs[runs.length - 1].gapAfter, opts.glossGap);
      runs.push({ lang: 'en', kind: 'gloss', text: node.en, part: partIndex, gapAfter: opts.glossGap });
    }
  });

  // trim, and put the between-sentence silence on the last run
  const trimmed = runs.filter((run) => run.text.trim());
  for (const run of trimmed) run.speaker = sentence.speaker || null;
  if (trimmed.length) {
    const last = trimmed[trimmed.length - 1];
    last.gapAfter = Math.max(last.gapAfter, sentence.endsParagraph ? opts.paragraphGap : opts.sentenceGap);
  }
  return trimmed;
}

/**
 * A listen-and-repeat drill from a phrase list: the English, a gap long enough
 * to try it yourself, then the Spanish. Shaped exactly like narration, so the
 * player and the audio export take it without knowing the difference.
 */
export function buildDrill(phrases, { gap = 2600, answerGap = 900, repeat = false } = {}) {
  return phrases.map((phrase, index) => {
    const runs = [
      { lang: 'en', kind: 'prompt', text: phrase.en, gapAfter: gap, part: 0, speaker: null },
      { lang: 'es', kind: 'answer', text: phrase.es, gapAfter: repeat ? 500 : answerGap, part: 1, speaker: null },
    ];
    if (repeat) runs.push({ lang: 'es', kind: 'answer', text: phrase.es, gapAfter: answerGap, part: 1, speaker: null });
    return {
      index,
      paragraphStart: true,
      endsParagraph: true,
      speaker: null,
      parts: [{ type: 'prompt', text: phrase.en }, { type: 'answer', text: phrase.es }],
      runs,
    };
  });
}

/** The plain text of a sentence, as it will be spoken. */
export function sentenceText(sentence) {
  const glosses = new Map();
  for (const run of sentence.runs) if (run.kind === 'gloss') glosses.set(run.part, run.text);
  return sentence.parts.map((part, i) => {
    if (part.type === 'speaker') return '';
    if (part.type === 'text') return part.text;
    const gloss = glosses.get(i);
    return part.node.text + (gloss ? ` (${gloss})` : '');
  }).join('').replace(/\s+/g, ' ').trim();
}

/**
 * Group runs into as few requests as a remote voice service needs: consecutive
 * runs in the same language become one request, with the pauses carried along
 * so they can be re-inserted as real silence.
 */
export function batchRuns(sentences, { maxChars = 900 } = {}) {
  const batches = [];
  let current = null;
  const push = (run, sentenceIndex) => {
    if (current && current.lang === run.lang && current.text.length + run.text.length < maxChars && !current.closed) {
      current.parts.push({ ...run, sentenceIndex });
      current.text += (/\s$/.test(current.text) || /^[\s,.;:!?]/.test(run.text) ? '' : ' ') + run.text;
      current.pendingGap = run.gapAfter;
      if (run.gapAfter >= 400) current.closed = true;
      return;
    }
    current = {
      lang: run.lang, text: run.text, parts: [{ ...run, sentenceIndex }],
      pendingGap: run.gapAfter, closed: run.gapAfter >= 400,
    };
    batches.push(current);
  };
  sentences.forEach((sentence) => sentence.runs.forEach((run) => push(run, sentence.index)));
  return batches.map(({ lang, text, parts }) => ({
    lang,
    text: text.replace(/\s+/g, ' ').trim(),
    gapAfter: parts[parts.length - 1].gapAfter,
    from: parts[0].sentenceIndex,
    to: parts[parts.length - 1].sentenceIndex,
  })).filter((b) => b.text);
}
