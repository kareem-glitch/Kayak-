// Trade bars: players take turns of N bars over the band (like trading fours),
// and it works at any distance.
//  - Only the player whose turn it is is heard.
//  - Everyone else's band follows the soloist: it runs just late enough (their
//    network delay) that the soloist's playing arrives exactly on the beat and
//    on the right chord. The soloist's own band never moves.
//  - At each handover the new soloist carries on; everyone else re-aligns to
//    them on the bar line, which leaves a tiny breath (about one round trip).
// Each device works out whose turn it is from its own band position, so what
// it shows always matches what it hears.
import { S, me } from './state.js';
import { clk } from './util.js';
import * as band from './band/engine.js';
import * as room from './net/room.js';

export const hooks = { onTurn: () => {} };   // UI, every tick: see info()
const AHEAD = 700;             // prepare each handover this long before it (ms)
const follow = new Map();      // id -> delay (ms) from their playing to your hearing, while you follow them
let prepared = null, lastStarted = null, bsTimer = null;

export const trading = () => S.game.mode === 'trade';
const active = () => trading() && S.playing && band.started && S.arr;
// Turn order: everyone in the room, the same on every device.
export const order = () => [me.id, ...[...room.peers.entries()].filter(([, p]) => p.name).map(([id]) => id)].sort();
export const nameOf = id => id === me.id ? me.name : ((room.peers.get(id) || {}).name || '');
const beatMs = () => 60000 / S.arr.bpm;
const turnMs = () => 4 * beatMs() * S.game.bars;
const leaderOf = k => { const o = order(); return o[((k % o.length) + o.length) % o.length]; };

// How long after they play you can hear it: their input delay, the slowest
// recent arrival, and a little headroom.
function delayFor(id){
  const p = room.peers.get(id); if(!p) return 150;
  const ages = [...(p.ages || [])].sort((a, b) => a - b);
  const age = ages.length > 20 ? ages[Math.floor(ages.length * 0.98)] : (p.rtt || 150) / 2 + 20;
  return Math.min(2000, Math.max(20, (p.inMs || 0) + age + 15));
}
// When their band's position 0 sounds, on my clock (they tell everyone; see 'bs').
const startOf = (id, prev) => { const p = room.peers.get(id), raw = p && (prev ? p.bsPrev : p.bs); return raw == null ? (prev ? null : band.started.base) : raw - p.offset; };

// Incoming audio: play the soloist exactly `follow` ms after they played it
// (on the beat, since this band runs that much behind theirs); drop everyone else.
room.setRoute((id, capturedAt, p) => {
  if(!active() || capturedAt == null) return undefined;
  const d = follow.get(id); if(d == null) return null;
  const played = capturedAt - (p.inMs || 0), seg = turnMs();
  const theirs = (start, tail) => { if(start == null) return false; const pos = played - start, k = Math.floor(pos / seg); return pos >= 0 && leaderOf(k) === id || (tail && pos >= 0 && leaderOf(k - 1) === id && pos - k * seg < beatMs()); };
  return theirs(startOf(id), true) || theirs(startOf(id, true), true) ? played + d : null;   // their last notes may ring a beat past the handover
});

function tick(){
  const st = band.started;
  if(!S.playing || !st || !S.arr){ prepared = null; follow.clear(); hooks.onTurn(null); return; }
  if(st !== lastStarted){ lastStarted = st; prepared = null; follow.clear(); }   // a new song or restart
  const now = clk(), pos = now - st.zero, seg = trading() ? turnMs() : 4 * beatMs();
  const k = pos < 0 ? 0 : Math.floor(pos / seg) + 1, key = S.game.mode + S.game.bars + ':' + k;
  if(st.zero + k * seg - now < AHEAD && prepared !== key){ prepared = key; prepare(k, k * seg); }
  hooks.onTurn(info());
}

// Line this band up for the turn starting at boundary (ms into the song).
function prepare(k, boundary){
  const st = band.started;
  let target = st.zero;
  if(!trading()) target = st.base;   // free jam: everyone on the room's shared timing
  else {
    const lead = leaderOf(k);
    if(lead !== me.id){ const d = delayFor(lead); follow.set(lead, d); target = startOf(lead) + d; }
  }
  if(Math.abs(target - st.zero) > 1){ band.shiftStart(boundary, target); tellStart(); }
}

const tellStart = () => { if(band.started) room.send({ t:'bs', start: band.started.zero }); };
// 'bs': another player's band start (their clock). Returns true if handled.
export function handle(m, id){
  if(m.t !== 'bs') return false;
  const p = room.peers.get(id); if(!p) return true;
  if(p.bs != null && Math.abs(p.bs - m.start) > 1) p.bsPrev = p.bs;
  p.bs = m.start; return true;
}

// What the screen shows: whose turn it is (as you hear it), who's next, and a
// countdown in the bar before your turn.
export function info(){
  const st = band.started; if(!st || !S.arr || !trading()) return { mode: S.game.mode };
  const now = clk(), pos = now - st.zero, seg = turnMs(), k = Math.floor(pos / seg);
  const next = pos < 0 ? 0 : k + 1, untilNext = st.zero + next * seg - now;
  const count = leaderOf(next) === me.id && untilNext <= 4 * beatMs() ? Math.ceil(untilNext / beatMs()) : 0;
  return { mode: 'trade', bars: S.game.bars, leader: pos < 0 ? null : leaderOf(k), next: leaderOf(next), mine: pos >= 0 && leaderOf(k) === me.id, count, nameOf };
}

export function start(){
  setInterval(tick, 50);
  bsTimer = setInterval(() => { if(S.playing) tellStart(); }, 1000);
}
