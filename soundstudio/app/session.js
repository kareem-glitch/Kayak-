// The jam session: who runs the band, arrangement, synced start/stop, seats.
// The band host is the source of truth and broadcasts S; every device runs its
// own band (band/engine.js) started on the shared clock.
import { S, me } from './state.js';
import { clk } from './util.js';
import { finalize, localArrangement } from './band/theory.js';
import * as band from './band/engine.js';
import * as room from './net/room.js';

export const hooks = { onChange: () => {} };   // UI re-render
let bandT0 = 0, bandCounter0 = 0;   // band host only: when and where the band started

export function broadcastState(to){ if(!me.isHost) return; room.send({ t:'state', arr:S.arr, playing:S.playing, seats:S.seats, levels:S.levels, hostId:S.hostId, hostName:S.hostName }, to); }

export async function claimBand(){
  if(S.hostId && S.hostId !== me.id) return false;
  await Tone.start();
  band.ensureEngine();
  me.isHost = true; S.hostId = me.id; S.hostName = me.name;
  if(!S.arr) S.arr = finalize(localArrangement('Slow funk in E minor, 96 bpm'), 'local');
  band.applyMutes(); broadcastState(); hooks.onChange();
  return true;
}

// countIn: one bar of clicks before the band comes in.
export async function startBand(countIn){
  const at = clk() + 600, c0 = countIn ? -16 : 0;   // 0.6 s for the message to arrive
  bandT0 = at; bandCounter0 = c0;
  broadcastState(); room.send({ t:'start', at, counter:c0 });
  await band.playAt(at, c0); broadcastState();
}
export function stopBand(){ room.send({ t:'stop' }); band.stopLocal(); broadcastState(); }

// Someone joined mid-song: start their band at the next bar line, in step.
function sendCatchUp(id){
  if(!S.playing || !bandT0) return;
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
export async function setTempo(bpm){ S.arr.bpm = bpm; broadcastState(); hooks.onChange(); if(S.playing) await startBand(false); }

// Arrangement from a prompt: Claude via /api/arrange if configured, else the
// built-in interpreter. Returns a note for the UI.
export async function generate(prompt){
  let arr = null, note = '';
  try{
    const r = await fetch('/api/arrange', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ prompt }) });
    if(r.ok) arr = finalize(await r.json(), 'claude');
  }catch(e){}
  if(!arr){ arr = finalize(localArrangement(prompt), 'local'); note = 'Arranged with the built-in interpreter.'; }
  S.arr = arr;
  band.applyMutes(); broadcastState(); hooks.onChange();
  if(S.playing) await startBand(false);
  return note || (S.playing ? 'New arrangement is playing.' : 'Ready. Press play.');
}

// Band messages from the room.
export function handleMessage(m, id){
  if(m.t === 'hello'){ if(me.isHost){ broadcastState(id); sendCatchUp(id); } return; }
  if(m.t === 'state' && !me.isHost){ const playing = S.playing; Object.assign(S, { arr:m.arr, seats:m.seats, levels:m.levels || S.levels, hostId:m.hostId, hostName:m.hostName }); band.applyMutes(); hooks.onChange(); S.playing = playing; }
  else if(m.t === 'start' && !me.isHost){ const go = () => band.playAt(m.at - room.offsetTo(id), m.counter); if(room.clockSynced(id)) go(); else setTimeout(go, 1300); }   // wait for the clocks to sync
  else if(m.t === 'stop' && !me.isHost){ band.stopLocal(); }
  else if(m.t === 'seat' && me.isHost){ setSeat(m.id, m.human, m.who); }
}

// The band host left: nobody runs the band now.
export function peerLeft(id){
  if(S.hostId !== id) return;
  S.hostId = null; S.hostName = ''; band.stopLocal();
  S.seats.forEach(s => { s.human = false; s.who = ''; }); band.applyMutes();
}
