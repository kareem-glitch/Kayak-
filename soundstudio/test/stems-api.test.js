// The stems endpoint: a prompt naming a real artist is refused by the music
// service with a suggested rewording; the endpoint retries with it and says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import handler from '../api/stems.js';

// A one-file zip, as the stem service returns.
function zip(name, data){
  const n = Buffer.from(name), c = deflateRawSync(data), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(c.length, 18); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(c.length, 20); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const cdStart = 30 + n.length + c.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, n, c, central, n, end]);
}
const res = () => { const r = { code: 0, body: null, headers: {} }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
const bad = { detail: { status: 'bad_prompt', message: 'Terms of Service', data: { reason: 'copyrighted_material_detected',
  prompt_suggestion: 'Instrumental backing track: energetic funk with groovy basslines, 100 bpm. Seamless loop: no intro, no fade-in, no ending, no fade-out. No vocals.' } } };

test('a refused prompt is retried with the suggested rewording', async () => {
  process.env.ELEVENLABS_API_KEY = 'k';
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    if(/\/music\?/.test(url)){ const p = JSON.parse(opts.body).prompt; sent.push(p); return /Chili/.test(p) ? new Response(JSON.stringify(bad), { status: 400 }) : new Response(Buffer.from('mp3')); }
    return new Response(zip('stems/drums.mp3', Buffer.from('beat')));
  };
  const r = res(); await handler({ method: 'POST', headers: {}, body: { prompt: 'funk like Red Hot Chili Peppers, 100 bpm' } }, r);
  assert.equal(r.code, 200);
  assert.equal(sent.length, 2, 'asked twice');
  assert.match(sent[1], /energetic funk/, 'the second time with the suggestion');
  assert.equal(r.body.reworded, 'energetic funk with groovy basslines, 100 bpm.', 'tells the player what it made');
  assert.ok(r.body.stems.drums, 'stems came back');
});

test('a refusal without a suggestion explains itself', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: { status: 'bad_prompt', data: { reason: 'copyrighted_material_detected' } } }), { status: 400 });
  const r = res(); await handler({ method: 'POST', headers: {}, body: { prompt: 'x' } }, r);
  assert.equal(r.code, 502);
  assert.match(r.body.error, /artist and song names/);
});
