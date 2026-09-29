// Prompt -> backing track -> stems, with ElevenLabs (music + stem separation).
// POST { prompt }: open to anyone for now (no access code). Returns
// { stems: { drums: base64 mp3, bass: ..., ... }, seconds }.
// The band host's device then shares the stems with the room directly.
import { inflateRawSync } from 'node:zlib';

const API = 'https://api.elevenlabs.io/v1';
const TAIL = ' Seamless loop: no intro, no fade-in, no ending, no fade-out. No vocals.';

// The stem service returns a zip; read it via its central directory.
export function unzip(buf){
  const b = Buffer.from(buf), files = {};
  let e = b.length - 22; while(e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if(e < 0) throw new Error('not a zip');
  let p = b.readUInt32LE(e + 16); const count = b.readUInt16LE(e + 10);
  for(let i = 0; i < count; i++){
    if(b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28);
    const skip = nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28), data = b.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    p += 46 + skip;
  }
  return files;
}

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const key = process.env.ELEVENLABS_API_KEY;
  if(!key) return res.status(501).json({ error: 'Stems are not set up on this server' });
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, 400);
  if(!prompt) return res.status(400).json({ error: 'Describe the track first' });
  try{
    const mr = await fetch(`${API}/music?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: `Instrumental backing track: ${prompt}.${TAIL}`, music_length_ms: 30000 }) });
    if(!mr.ok) return res.status(502).json({ error: 'The music service said no (' + mr.status + ')', detail: (await mr.text()).slice(0, 300) });
    const mix = Buffer.from(await mr.arrayBuffer());
    const form = new FormData(); form.append('file', new Blob([mix], { type: 'audio/mpeg' }), 'mix.mp3');
    const sr = await fetch(`${API}/music/stem-separation?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
    if(!sr.ok) return res.status(502).json({ error: 'The stem service said no (' + sr.status + ')', detail: (await sr.text()).slice(0, 300) });
    const files = unzip(await sr.arrayBuffer()), stems = {};
    for(const [n, data] of Object.entries(files)){ const name = n.split('/').pop().replace(/\.\w+$/, ''); if(name !== 'vocals') stems[name] = data.toString('base64'); }
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ stems, seconds: 30 });
  }catch(e){
    return res.status(500).json({ error: 'Couldn’t make the track: ' + (e.message || e) });
  }
}
