// The jam session: who runs the band, arrangement, synced start/stop, seats.
// The band host is the source of truth and broadcasts S; every device runs its
// own band (band/engine.js) started on the shared clock.
import { S, me } from './state.js';
import { clk } from './util.js';
import { finalize, localArrangement } from './band/theory.js';
import * as band from './band/engine.js';
import * as room from './net/room.js';
import * as lyria from './band/lyria.js';
import * as stems from './band/stems.js';

export const hooks = { onChange: () => {}, onNote: () => {} };   // UI re-render, band status line
// Where the band comes from (the host picks):
//   'stock'  ready-made tracks split into parts (band/stems.js)
//   'prompt' a track made from your description and split into parts (/api/stems)
//   'live'   Google's Lyria live band through our relay (band/lyria.js)
// 'tone' (the built-in synth band) is used by tests (?band=tone) and as the fallback.
export let mode = 'stock';
let useLyria = true;
export function setLyria(on){ useLyria = on; if(!on) mode = 'tone'; }
export function setMode(m){ if(mode !== 'tone') mode = m; }
const withEngine = arr => Object.assign(arr, { engine: useLyria ? 'lyria' : 'tone' });
// Everyone listens to where the band comes from: the Lyria relay, or a stems track.
function listen(){
  if(!S.arr) return;
  if(S.arr.engine === 'lyria') lyria.connect(room.roomId());
  if(S.arr.engine === 'stems' && S.arr.pack.source === 'stock') stems.loadStock(S.arr.pack.id).catch(e => console.warn('stock track failed', e));
}
export const STOCK = ['funk-em-96', 'blues-a-92', 'neosoul-dm-84', 'rock-d-120', 'lofi-f-80'];
const stemsArr = (meta, extra) => Object.assign({ title:meta.title, style:meta.style, key:meta.key, bpm:meta.bpm, swing:false, chords:[], barMap:[], bass:'', keys:'', guitar:'', notes:'', engine:'stems' }, extra);

// A stock track: everyone loads the same files from the site.
export async function chooseStock(id){
  const meta = await (await fetch(`/packs/${id}/pack.json`)).json();
  S.arr = stemsArr(meta, { source:'stock', pack:{ id, source:'stock', parts:Object.keys(meta.stems) } });
  await stems.loadStock(id);
  band.applyMutes(); broadcastState(); hooks.onChange();
  if(S.playing) await startBand(false);
  return `${meta.title} in ${meta.key}. Press play.`;
}

// A prompted track: made on the server, then the host shares the parts with the room.
async function generateStems(prompt, code){
  const base = finalize(localArrangement(prompt), 'local');   // reads tempo and key from the words
  const r = await fetch('/api/stems', { method:'POST', headers:{ 'content-type':'application/json', 'x-stems-code':code || '' },
    body:JSON.stringify({ prompt:`${prompt}. ${base.bpm} bpm, key of ${base.key || 'E minor'}` }) });
  const j = await r.json().catch(() => ({}));
  if(r.status === 403) return { error:'code' };
  if(!r.ok) return { error:j.error || 'Couldn’t make the track.' };
  const id = 'p' + Date.now().toString(36);
  await stems.loadData(id, base.bpm, j.stems);
  S.arr = stemsArr({ title:base.title, style:base.style, key:base.key, bpm:base.bpm }, { prompt, source:'prompt', pack:{ id, source:'prompt', parts:stems.parts() } });
  band.applyMutes(); broadcastState(); shareStems(); hooks.onChange();
  if(S.playing) await startBand(false);
  return { note:'Your track is ready. Press play.' };
}
// Send the parts to one player (or everyone) in small pieces over the room's connections.
const CHUNK = 48000;
function shareStems(to){
  const data = stems.payload(); if(!data || !S.arr || S.arr.engine !== 'stems') return;
  const id = S.arr.pack.id;
  for(const [name, b64] of Object.entries(data)){
    if(!S.arr.pack.parts.includes(name)) continue;
    const n = Math.ceil(b64.length / CHUNK);
    for(let i = 0; i < n; i++) room.send({ t:'stemdata', id, name, i, n, d:b64.slice(i * CHUNK, (i + 1) * CHUNK) }, to);
  }
}
const incoming = {};   // pack id -> part name -> chunks
function gotStemData(m){
  if(!S.arr || !S.arr.pack || S.arr.pack.id !== m.id || stems.ready(m.id)) return;
  const pack = incoming[m.id] || (incoming[m.id] = {}), part = pack[m.name] || (pack[m.name] = new Array(m.n));
  part[m.i] = m.d;
  const done = S.arr.pack.parts.every(p => pack[p] && pack[p].every(x => typeof x === 'string'));
  if(done){ const data = {}; for(const p of S.arr.pack.parts) data[p] = pack[p].join(''); delete incoming[m.id]; stems.loadData(m.id, S.arr.bpm, data); }
}
let bandT0 = 0, bandCounter0 = 0;   // band host only: when and where the band started

export function broadcastState(to){ if(!me.isHost) return; room.send({ t:'state', arr:S.arr, playing:S.playing, seats:S.seats, levels:S.levels, game:S.game, hostId:S.hostId, hostName:S.hostName }, to); }

export async function claimBand(){
  if(S.hostId && S.hostId !== me.id) return false;
  await Tone.start();
  band.ensureEngine();
  me.isHost = true; S.hostId = me.id; S.hostName = me.name;
  if(mode === 'tone') S.game = { mode:'free', bars:8 };   // the built-in band can't trade
  if(!S.arr && mode !== 'tone'){ await chooseStock(STOCK[0]).catch(() => {}); }
  if(!S.arr) S.arr = withEngine(Object.assign(finalize(localArrangement('Slow funk in E minor, 96 bpm'), 'local'), { prompt:'Slow funk in E minor, 96 bpm' }));
  listen(); band.applyMutes(); broadcastState(); hooks.onChange();
  return true;
}

// countIn: one bar of clicks before the band comes in.
export async function startBand(countIn){
  if(S.arr.engine === 'lyria'){ if(await startLyria()) return; }
  if(S.arr.engine === 'stems'){   // no count-in; a little longer for everyone to be ready
    const at = clk() + 1500; bandT0 = at; bandCounter0 = 0;
    broadcastState(); room.send({ t:'start', at, counter:0 });
    await band.playAt(at, 0); broadcastState(); return;
  }
  const at = clk() + 600, c0 = countIn ? -16 : 0;   // 0.6 s for the message to arrive
  bandT0 = at; bandCounter0 = c0;
  broadcastState(); room.send({ t:'start', at, counter:c0 });
  await band.playAt(at, c0); broadcastState();
}
// Lyria: ask the relay for a new stream, wait for its first chunk, then start
// everyone LEAD_MS later (so every device has the audio before it's due).
// Falls back to the built-in band if the music engine can't be reached.
async function startLyria(){
  hooks.onNote('Your band is warming up…');
  try{
    lyria.connect(room.roomId());
    const first = new Promise((res, rej) => { lyria.hooks.onFirstChunk = res; setTimeout(() => rej(new Error(lyria.state.message || 'The music engine didn’t answer')), 15000); });
    await lyria.play();
    const at = await first + lyria.LEAD_MS;
    bandT0 = at; bandCounter0 = 0;
    broadcastState(); room.send({ t:'start', at, counter:0 });
    await band.playAt(at, 0); broadcastState();
    hooks.onNote('Playing: Google Lyria, live');
    return true;
  }catch(e){
    console.warn('Lyria unavailable, using the built-in band', e);
    lyria.stop(); S.arr.engine = 'tone'; band.ensureEngine(); broadcastState(); hooks.onChange();
    hooks.onNote('The AI band server isn’t available right now, so the built-in band is playing.');
    return false;
  }
}
export function stopBand(){ if(S.arr && S.arr.engine === 'lyria') lyria.stop(); room.send({ t:'stop' }); band.stopLocal(); broadcastState(); }

// Someone joined mid-song: start their band at the next bar line, in step.
function sendCatchUp(id){
  if(!S.playing || !bandT0) return;
  if(S.arr.engine === 'lyria' || S.arr.engine === 'stems'){ room.send({ t:'start', at:bandT0, counter:0 }, id); return; }   // the loop / stream position follows from the start time
  const barMs = 4 * 60000 / S.arr.bpm, k = Math.ceil((clk() + 800 - bandT0) / barMs);
  room.send({ t:'start', at:bandT0 + k * barMs, counter:bandCounter0 + k * 16 }, id);
}

export function setSeat(id, human, who){
  const s = S.seats.find(x => x.id === id); if(!s) return;
  s.human = !!human; s.who = String(who || '').slice(0, 40);
  band.applyMutes(); broadcastState(); hooks.onChange();
}
export function toggleSeat(id){
  const s = S.seats.find(x => x.id === id); if(!s) return;
  const human = !s.human, who = human ? me.name : '';
  if(me.isHost) setSeat(id, human, who);
  else if(S.hostId) room.send({ t:'seat', id, human, who }, S.hostId);
}
export function setLevel(id, db){ S.levels[id] = db; band.applyMutes(); clearTimeout(setLevel.t); setLevel.t = setTimeout(broadcastState, 150); }
export function setGame(game){ S.game = Object.assign({}, S.game, game); broadcastState(); hooks.onChange(); }
export async function setTempo(bpm){ S.arr.bpm = bpm; broadcastState(); hooks.onChange(); if(S.playing) await startBand(false); }

// Arrangement from a prompt: Claude via /api/arrange if configured, else the
// built-in interpreter. Returns a note for the UI.
export async function generate(prompt, opts = {}){
  if(mode === 'prompt'){ const r = await generateStems(prompt, opts.code); return r; }
  let arr = null, note = '';
  try{
    const r = await fetch('/api/arrange', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ prompt }) });
    if(r.ok) arr = finalize(await r.json(), 'claude');
  }catch(e){}
  if(!arr){ arr = finalize(localArrangement(prompt), 'local'); note = 'Arranged with the built-in interpreter.'; }
  S.arr = withEngine(Object.assign(arr, { prompt })); if(S.arr.engine === 'lyria') note = '';
  listen();
  band.applyMutes(); broadcastState(); hooks.onChange();
  if(S.playing) await startBand(false);
  return note || (S.playing ? 'New arrangement is playing.' : 'Ready. Press play.');
}

// Band messages from the room.
export function handleMessage(m, id){
  if(m.t === 'hello'){ if(me.isHost){ broadcastState(id); if(S.arr && S.arr.engine === 'stems' && S.arr.pack.source === 'prompt') shareStems(id); sendCatchUp(id); } return; }
  if(m.t === 'stemdata' && !me.isHost){ gotStemData(m); return; }
  if(m.t === 'state' && !me.isHost){ const playing = S.playing; Object.assign(S, { arr:m.arr, seats:m.seats, levels:m.levels || S.levels, game:m.game || S.game, hostId:m.hostId, hostName:m.hostName }); listen(); band.applyMutes(); hooks.onChange(); S.playing = playing; }
  else if(m.t === 'start' && !me.isHost){ const go = () => band.playAt(m.at - room.offsetTo(id), m.counter); if(room.clockSynced(id)) go(); else setTimeout(go, 1300); }   // wait for the clocks to sync
  else if(m.t === 'stop' && !me.isHost){ band.stopLocal(); }
  else if(m.t === 'seat' && me.isHost){ setSeat(m.id, m.human, m.who); }
}

// The band host left: nobody runs the band now.
export function peerLeft(id){
  if(S.hostId !== id) return;
  S.hostId = null; S.hostName = ''; band.stopLocal(); lyria.stopLocal(); stems.stop();
  S.seats.forEach(s => { s.human = false; s.who = ''; }); band.applyMutes();
}
