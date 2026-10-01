// Separate tracks: while recording the whole jam, each player's audio (and the
// band) is also kept on its own, lined up on one timeline the way you heard it,
// and saved as one WAV per track in a .zip, ready to drag into a DAW.
// Same in the browser and the desktop app: players come from the room's taps.
import * as room from './net/room.js';
import { clk } from './util.js';

const SR = 48000;
let rec = null;

export function start(names){
  rec = { t0: clk(), names, tracks: new Map(), band: null };
  room.taps.tracks = (id, planes, atMs) => place(id, planes, atMs);
  // the band: Tone's output streamed into a plain 48 kHz context and tapped there
  // (the same route the whole-jam recording takes; Tone's own context is wrapped)
  try{
    const ctx = new AudioContext({ sampleRate: SR }), dest = Tone.getContext().rawContext.createMediaStreamDestination();
    Tone.connect(Tone.getDestination(), dest);
    rec.band = { chunks: [], rate: SR, startAt: null, ctx, dest };
    ctx.audioWorklet.addModule(new URL('./audio/rectap.js', import.meta.url)).then(() => {
      if(!rec) return;
      const node = new AudioWorkletNode(ctx, 'rec-tap', { numberOfInputs: 1, numberOfOutputs: 1 });
      node.port.onmessage = e => { if(!rec) return; if(rec.band.startAt === null) rec.band.startAt = clk() - (ctx.baseLatency || 0) * 1000; rec.band.chunks.push(e.data); };
      ctx.createMediaStreamSource(dest.stream).connect(node);
    }).catch(e => console.warn('band track unavailable', e));
  }catch(e){ console.warn('band track unavailable', e); }
}

// Put one 128-frame block where it was heard. Blocks that follow on (within a
// couple of blocks) are written back to back so jitter doesn't leave clicks.
function place(id, planes, atMs){
  if(!rec) return;
  let t = rec.tracks.get(id); if(!t){ t = { blocks: [], end: 0 }; rec.tracks.set(id, t); }
  const n = planes[0].length;
  let pos = Math.round((atMs - rec.t0) / 1000 * SR);
  if(Math.abs(pos - t.end) <= 2 * n) pos = t.end;
  if(pos < 0) return;
  t.blocks.push({ pos, data: planes[0].slice(0) });
  t.end = Math.max(t.end, pos + n);
}

export async function stop(){
  if(!rec) return null;
  const r = rec; rec = null; room.taps.tracks = null;
  const files = [];
  for(const [id, t] of r.tracks){
    const out = new Float32Array(t.end);
    for(const b of t.blocks) out.set(b.data, b.pos);
    files.push({ name: safe(id === 'me' ? 'You' : (r.names(id) || id)) + '.wav', data: wav24(out, SR) });
  }
  if(r.band){
    try{ Tone.getDestination().disconnect(r.band.dest); }catch(e){}
    r.band.ctx.close();
    const b = r.band, n = b.chunks.reduce((a, c) => a + c[0].length, 0);
    if(n && b.startAt !== null){
      const l = new Float32Array(n), rr = new Float32Array(n); let o = 0;
      for(const c of b.chunks){ l.set(c[0], o); rr.set(c[1], o); o += c[0].length; }
      const lead = Math.max(0, Math.round((b.startAt - r.t0) / 1000 * SR));
      files.push({ name: 'Band.wav', data: wav24(pad(resample(l, b.rate), lead), SR, pad(resample(rr, b.rate), lead)) });
    }
  }
  if(!files.length) return null;
  return URL.createObjectURL(new Blob([zip(files)], { type: 'application/zip' }));
}

const safe = s => String(s).replace(/[^\w\- .]+/g, '').trim().slice(0, 40) || 'Player';
const pad = (x, k) => { if(!k) return x; const o = new Float32Array(x.length + k); o.set(x, k); return o; };
function resample(x, from){
  if(from === SR) return x;
  const n = Math.floor(x.length * SR / from), o = new Float32Array(n), step = from / SR;
  for(let i = 0; i < n; i++){ const p = i * step, a = Math.floor(p), f = p - a; o[i] = (x[a] || 0) + ((x[a + 1] || 0) - (x[a] || 0)) * f; }
  return o;
}
// 24-bit PCM WAV, mono or stereo
function wav24(l, sr, r = null){
  const ch = r ? 2 : 1, n = l.length, b = new DataView(new ArrayBuffer(44 + n * ch * 3));
  const str = (o, s) => { for(let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + n * ch * 3, true); str(8, 'WAVE'); str(12, 'fmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, ch, true); b.setUint32(24, sr, true);
  b.setUint32(28, sr * ch * 3, true); b.setUint16(32, ch * 3, true); b.setUint16(34, 24, true); str(36, 'data'); b.setUint32(40, n * ch * 3, true);
  let o = 44;
  for(let i = 0; i < n; i++) for(let c = 0; c < ch; c++){
    const v = Math.max(-1, Math.min(1, (c ? r : l)[i])), s = Math.round(v * 8388607);
    b.setUint8(o, s & 255); b.setUint8(o + 1, (s >> 8) & 255); b.setUint8(o + 2, (s >> 16) & 255); o += 3;
  }
  return new Uint8Array(b.buffer);
}
// A .zip with no compression (WAV barely compresses): local headers, central directory, end record.
const CRC = (() => { const t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = d => { let c = 0xFFFFFFFF; for(let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function zip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for(const f of files){
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
}
