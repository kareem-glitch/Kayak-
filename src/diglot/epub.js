// EPUB in and out, with no dependencies.
//
// Reading uses the browser/Node DecompressionStream for deflated entries;
// writing stores everything uncompressed, which is a perfectly legal ZIP and
// keeps the writer to a CRC table and a few headers. Good enough for books of
// the size a person actually reads.

// ── CRC32 ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── reading ─────────────────────────────────────────────────────────────────

/** Read a ZIP into a Map of path → Uint8Array. */
export async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // Find the end-of-central-directory record (it has a variable-length comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    // The local header repeats the name and has its own extra field length.
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name.endsWith('/')) continue;
    files.set(name, method === 0 ? raw : await inflate(raw));
  }
  return files;
}

async function inflate(raw) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip compressed EPUBs');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);

/**
 * Pull a readable book out of an EPUB: title, author, and chapters of text.
 * Falls back to document order if the spine can't be read.
 */
export async function readEpub(buffer) {
  const files = await unzip(buffer);
  const parser = new DOMParser();

  const containerFile = files.get('META-INF/container.xml');
  let opfPath = null;
  if (containerFile) {
    const container = parser.parseFromString(decode(containerFile), 'application/xml');
    opfPath = container.querySelector('rootfile')?.getAttribute('full-path') || null;
  }
  if (!opfPath) opfPath = [...files.keys()].find((k) => k.endsWith('.opf'));
  if (!opfPath) throw new Error('No OPF package file — is this really an EPUB?');

  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = parser.parseFromString(decode(files.get(opfPath)), 'application/xml');
  const title = opf.querySelector('metadata > *|title, title')?.textContent?.trim() || 'Untitled';
  const author = opf.querySelector('metadata > *|creator, creator')?.textContent?.trim() || '';

  const manifest = new Map();
  opf.querySelectorAll('manifest > item').forEach((item) => {
    manifest.set(item.getAttribute('id'), {
      href: item.getAttribute('href'),
      type: item.getAttribute('media-type'),
    });
  });
  const spine = [...opf.querySelectorAll('spine > itemref')]
    .map((ref) => manifest.get(ref.getAttribute('idref')))
    .filter((item) => item && /xhtml|html/.test(item.type || ''));
  const docs = spine.length ? spine.map((s) => resolve(base, s.href))
    : [...files.keys()].filter((k) => /\.x?html?$/i.test(k)).sort();

  const chapters = [];
  for (const path of docs) {
    const file = files.get(path) || files.get(decodeURIComponent(path));
    if (!file) continue;
    const doc = parser.parseFromString(decode(file), 'text/html');
    const heading = doc.querySelector('h1, h2, h3, title')?.textContent?.trim() || '';
    const text = htmlToText(doc.body || doc.documentElement);
    if (text.split(/\s+/).length < 20) continue; // covers, blank pages
    chapters.push({ title: heading || `Part ${chapters.length + 1}`, text });
  }
  if (!chapters.length) throw new Error('No readable chapters found in this EPUB');
  return { title, author, chapters };
}

function resolve(base, href) {
  const path = base + href;
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** Flatten a DOM subtree to text with blank lines between blocks. */
export function htmlToText(root) {
  if (!root) return '';
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script, style, nav, header, footer, aside, noscript, svg, form, iframe').forEach((n) => n.remove());
  const BLOCK = 'p, div, section, article, h1, h2, h3, h4, h5, h6, li, blockquote, tr, pre, br';
  clone.querySelectorAll(BLOCK).forEach((el) => {
    el.append(document.createTextNode('\n\n'));
  });
  return (clone.textContent || '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── writing ─────────────────────────────────────────────────────────────────

const utf8 = (s) => new TextEncoder().encode(s);

/** Build a ZIP (all entries stored) from [{ name, data }]. */
export function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const data = typeof entry.data === 'string' ? utf8(entry.data) : entry.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);       // version needed
    lv.setUint16(6, 0x0800, true);   // UTF-8 names
    lv.setUint16(8, 0, true);        // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}

const escapeXml = (s = '') => s.replace(/[<>&"']/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const EPUB_CSS = `
body { font-family: Georgia, serif; line-height: 1.6; margin: 1em; }
h1, h2 { font-family: Helvetica, Arial, sans-serif; line-height: 1.25; }
p { margin: 0 0 0.9em; text-indent: 0; }
.es { font-weight: 600; }
.gloss { font-size: 0.75em; color: #666; font-weight: normal; }
.vocab { font-size: 0.95em; }
.vocab dt { font-weight: 600; margin-top: 0.6em; }
.vocab dd { margin: 0 0 0 1.2em; color: #555; }
.note { color: #555; font-style: italic; }
`;

/**
 * Build a Send-to-Kindle-ready EPUB.
 * chapters: [{ title, html }]  vocab: [{ es, en }]
 */
export function buildEpub({ title, author = 'Diglot', chapters, vocab = [], level = 0, language = 'es' }) {
  const id = 'diglot-' + Date.now();
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [];

  const page = (heading, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(heading)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><h1>${escapeXml(heading)}</h1>
${body}
</body></html>`;

  chapters.forEach((ch, i) => {
    files.push({ name: `OEBPS/ch${i + 1}.xhtml`, data: page(ch.title || `Chapter ${i + 1}`, ch.html) });
  });

  if (vocab.length) {
    const list = vocab.map((v) => `<dt>${escapeXml(v.es)}</dt><dd>${escapeXml(v.en)}</dd>`).join('\n');
    files.push({
      name: 'OEBPS/vocab.xhtml',
      data: page('Vocabulary', `<p class="note">Every Spanish word woven into this text, in the order you met it.</p>\n<dl class="vocab">${list}</dl>`),
    });
  }

  const chapterItems = chapters.map((_, i) => `ch${i + 1}`).concat(vocab.length ? ['vocab'] : []);
  const manifest = chapterItems
    .map((cid) => `<item id="${cid}" href="${cid}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ');
  const spine = chapterItems.map((cid) => `<itemref idref="${cid}"/>`).join('\n    ');
  const navItems = chapters.map((ch, i) => `<li><a href="ch${i + 1}.xhtml">${escapeXml(ch.title || `Chapter ${i + 1}`)}</a></li>`)
    .concat(vocab.length ? ['<li><a href="vocab.xhtml">Vocabulary</a></li>'] : []).join('\n      ');

  files.push({
    name: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
      ${navItems}
</ol></nav></body></html>`,
  });

  files.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>Diglot weave at ${level}% ${escapeXml(language)}.</dc:description>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`,
  });

  files.push({ name: 'OEBPS/style.css', data: EPUB_CSS });
  files.push({
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  });

  // The mimetype entry must come first and be stored uncompressed.
  return zip([{ name: 'mimetype', data: 'application/epub+zip' }, ...files]);
}
