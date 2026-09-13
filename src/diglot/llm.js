// Optional Claude layer. Everything here needs the user's own API key, kept in
// their browser and sent only to api.anthropic.com.
//
// The key idea: Claude does NOT write the woven text. It returns an alignment —
// the Spanish for each notable word *in this context*, with a difficulty tier.
// We merge that into the lexicon, so the slider stays instant and local, and
// re-reading at a different level costs nothing.

const API = 'https://api.anthropic.com/v1/messages';

export const MODELS = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced (recommended)' },
  { id: 'claude-opus-5', label: 'Opus 5 — best quality, slower' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fastest, cheapest' },
];

async function callClaude({ apiKey, model, system, messages, maxTokens = 8000, signal }) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    signal,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error?.message) detail = body.error.message;
    } catch { /* keep the status line */ }
    throw new Error(detail);
  }
  const body = await res.json();
  return (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('No JSON in the model reply');
  const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
  return JSON.parse(candidate.slice(start, end + 1));
}

const ALIGN_SYSTEM = `You build vocabulary tables for a diglot-weave Spanish reader.

Given an English passage, list the words and short phrases worth teaching, with
the Spanish that fits THIS context. Rules:

- Give the dictionary form of the English word (singular noun, bare infinitive
  verb, positive adjective) and the matching Spanish dictionary form. The reader
  inflects them itself.
- pos is one of: n, v, adj, adv, prep, conj, pron, num, phrase.
- For nouns give grammatical gender "m" or "f". Otherwise omit gender.
- tier is 1–10: how hard the Spanish word is for an English speaker learning
  Spanish. 1 = a beginner's first hundred words or an obvious cognate,
  10 = advanced or literary.
- Prefer neutral peninsular Spanish. No regionalisms unless the text demands it.
- Skip proper nouns, numerals written as digits, and words whose Spanish would
  be identical to the English.
- Include multi-word phrases where a word-for-word swap would be wrong
  (idioms, phrasal verbs, fixed expressions).
- Cover the passage thoroughly: aim for every content word.

Reply with JSON only: [{"en":"...","es":"...","pos":"n","gender":"f","tier":3}]`;

/**
 * Ask Claude for a context-accurate vocabulary alignment of a passage.
 * Returns lexicon entries ready to merge, in this app's "en|es|pos|extra" shape.
 */
export async function alignPassage(text, { apiKey, model = MODELS[0].id, signal } = {}) {
  const reply = await callClaude({
    apiKey, model, signal,
    system: ALIGN_SYSTEM,
    messages: [{ role: 'user', content: `Passage:\n\n${text}` }],
  });
  const rows = extractJson(reply);
  const entries = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.en !== 'string' || typeof row.es !== 'string') continue;
    const en = row.en.trim().toLowerCase();
    const es = row.es.trim();
    if (!en || !es || en === es.toLowerCase()) continue;
    const pos = /^(n|v|adj|adv|prep|conj|pron|num|phrase)$/.test(row.pos) ? row.pos : 'n';
    const tier = Math.min(10, Math.max(1, Math.round(Number(row.tier) || 5)));
    entries.push({ en, es, pos, gender: row.gender === 'f' ? 'f' : 'm', tier });
  }
  return entries;
}

/** Align a long document a chunk at a time, reporting progress as it goes. */
export async function alignDocument(text, { apiKey, model, chunkWords = 700, onProgress, signal } = {}) {
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let buffer = [];
  let count = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean).length;
    if (count && count + words > chunkWords) { chunks.push(buffer.join('\n\n')); buffer = []; count = 0; }
    buffer.push(paragraph);
    count += words;
  }
  if (buffer.length) chunks.push(buffer.join('\n\n'));

  const merged = new Map();
  for (const [i, chunk] of chunks.entries()) {
    onProgress?.({ done: i, total: chunks.length });
    const entries = await alignPassage(chunk, { apiKey, model, signal });
    for (const entry of entries) if (!merged.has(entry.en)) merged.set(entry.en, entry);
  }
  onProgress?.({ done: chunks.length, total: chunks.length });
  return [...merged.values()];
}

const WRITE_SYSTEM = `You write original short articles for language learners to read.

- Write in clear, natural English — the reader will see it woven with Spanish.
- Concrete and specific: real detail, no filler, no throat-clearing intro.
- Short paragraphs. No headings, no bullet lists, no markdown.
- Never reproduce copyrighted text; write something original.
- Start with a one-line title on its own, then a blank line, then the article.`;

/** Generate an original article on a topic, to weave. */
export async function writeArticle(topic, { apiKey, model = MODELS[0].id, words = 400, signal } = {}) {
  const reply = await callClaude({
    apiKey, model, signal, maxTokens: 4000,
    system: WRITE_SYSTEM,
    messages: [{ role: 'user', content: `Write an article of about ${words} words about: ${topic}` }],
  });
  const lines = reply.trim().split('\n');
  const title = lines[0].replace(/^#+\s*/, '').trim();
  return { title, text: lines.slice(1).join('\n').trim() || reply.trim() };
}

/** Cheap key check: one token, so it costs essentially nothing. */
export async function testKey({ apiKey, model = MODELS[0].id }) {
  await callClaude({ apiKey, model, maxTokens: 1, system: 'Reply with "ok".', messages: [{ role: 'user', content: 'ok' }] });
  return true;
}

/** Turn Claude's entries into extra bands the weaver can index. */
export function entriesToBands(entries) {
  const bands = Array.from({ length: 10 }, () => []);
  for (const e of entries) {
    const extra = e.pos === 'n' ? `|${e.gender}` : '';
    bands[e.tier - 1].push(`${e.en}|${e.es}|${e.pos}${extra}`);
  }
  return bands;
}
