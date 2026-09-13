// Getting text in: from a URL, a pasted blob, a .txt file, or an EPUB.
// Everything runs in the browser — there's no server to send your reading to.

/**
 * Text-extraction proxies, tried in order. Both are public, CORS-friendly
 * services; if one is down or rate-limited we fall through to the next.
 */
const FETCHERS = [
  {
    name: 'jina',
    url: (u) => 'https://r.jina.ai/' + u,
    parse: (body) => fromMarkdown(body),
  },
  {
    name: 'allorigins',
    url: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    parse: (body) => fromHtml(body),
  },
];

/** Fetch a URL and pull the article text out of it. */
export async function fetchArticle(url, { signal } = {}) {
  const clean = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const errors = [];
  for (const fetcher of FETCHERS) {
    try {
      const res = await fetch(fetcher.url(clean), { signal, headers: { Accept: 'text/plain, text/html' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.text();
      const article = fetcher.parse(body);
      if (article.text.split(/\s+/).length > 120) return { ...article, url: clean, via: fetcher.name };
      errors.push(`${fetcher.name}: too little text`);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      errors.push(`${fetcher.name}: ${err.message}`);
    }
  }
  throw new Error(`Could not read that page (${errors.join('; ')})`);
}

/** r.jina.ai hands back markdown with a small header block. */
function fromMarkdown(body) {
  let title = '';
  let text = body;
  const header = body.match(/^Title:\s*(.+)$/m);
  if (header) title = header[1].trim();
  const marker = body.indexOf('Markdown Content:');
  if (marker !== -1) text = body.slice(marker + 'Markdown Content:'.length);

  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // links → their text
    .replace(/^\s*(={3,}|-{3,}|\*{3,})\s*$/gm, '')    // rules
    .replace(/^#{1,6}\s*/gm, '')                      // heading marks
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

/** A crude but effective readability pass: keep the densest block of prose. */
function fromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('meta[property="og:title"]')?.content
    || doc.querySelector('title')?.textContent?.trim() || '';
  doc.querySelectorAll('script, style, nav, header, footer, aside, noscript, form, iframe, figure, figcaption').forEach((n) => n.remove());

  const candidates = [...doc.querySelectorAll('article, main, [role="main"], .post, .article-body, .entry-content, #content, body')];
  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const paragraphs = el.querySelectorAll('p');
    let score = 0;
    paragraphs.forEach((p) => {
      const len = (p.textContent || '').trim().length;
      if (len > 80) score += len;
    });
    if (score > bestScore) { bestScore = score; best = el; }
  }
  const root = best || doc.body;
  const text = [...root.querySelectorAll('p, h2, h3, li, blockquote')]
    .map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 40)
    .join('\n\n');
  return { title, text: text || (root.textContent || '').replace(/\n{3,}/g, '\n\n').trim() };
}

/** Tidy pasted text: unwrap hard-wrapped lines, normalise blank lines. */
export function cleanText(raw) {
  const text = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const hardWrapped = /\n(?!\n)/.test(text)
    && text.split('\n').filter((l) => l.trim()).slice(0, 40).filter((l) => l.length < 90).length > 20;
  const unwrapped = hardWrapped
    ? text.replace(/([^\n.!?"'”’:])\n(?=[a-z(“"'])/g, '$1 ')
    : text;
  return unwrapped.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Break a long text into reader-sized sections at paragraph boundaries. */
export function splitIntoSections(text, targetWords = 900) {
  const paragraphs = text.split(/\n{2,}/);
  const sections = [];
  let buffer = [];
  let count = 0;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean).length;
    if (count && count + words > targetWords) {
      sections.push(buffer.join('\n\n'));
      buffer = [];
      count = 0;
    }
    buffer.push(paragraph);
    count += words;
  }
  if (buffer.length) sections.push(buffer.join('\n\n'));
  return sections.length ? sections : [text];
}

export const wordCount = (text) => (text.match(/[\p{L}\p{M}'’-]+/gu) || []).length;

/** Guess a title from the first line if we weren't given one. */
export function guessTitle(text, fallback = 'Untitled') {
  const first = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (!first) return fallback;
  const clipped = first.length > 70 ? first.slice(0, 67).replace(/\s+\S*$/, '') + '…' : first;
  return clipped.replace(/^#+\s*/, '') || fallback;
}
