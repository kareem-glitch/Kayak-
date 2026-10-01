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
import * as stems from './band/stems.js';
import * as soloist from './band/soloist.js';
import * as session from './session.js';
import * as audio from './audio/io.js';

export const hooks = { onTurn: () => {} };   // UI, every tick: see info()
const AHEAD = 700;             // prepare each handover this long before it (ms)
const follow = new Map();      // id -> delay (ms) from their playing to your hearing, while you follow them
let prepared = null, lastStarted = null, bsTimer = null;

export const soloistState = soloist.state;
export const trading = () => S.game.mode === 'trade';
const active = () => trading() && S.playing && band.started && S.arr;
// Turn order: everyone in the room, the same on every device, plus the AI band
// when you'd otherwise have nobody to trade with (or the host keeps it in).
export const AI = 'ai';
export function order(){
  const humans = [me.id, ...[...room.peers.entries()].filter(([, p]) => p.name).map(([id]) => id)].sort();
  return humans.length < 2 || S.game.ai ? [...humans, AI] : humans;
}
export const nameOf = id => id === AI ? 'The band' : id === me.id ? me.name : ((room.peers.get(id) || {}).name || '');
// On your turn the AI's version of your seat drops out; the rest of the time it covers for you.
let current = null;
stems.seatRule.playing = s => s.human && (!active() || current === null || session.holders(s).includes(nameOf(current)));
function onLeader(lead){
  if(lead === current) return;
  current = lead;
  const takenBy = n => S.seats.some(x => x.human && x.who && ({ piano:'keys' }[n] || n) === x.id);
  const lead0 = lead === AI && !soloist.state.ready ? ['guitar', 'piano', 'other'].find(n => stems.parts().includes(n) && !takenBy(n)) : null;
  stems.feature(lead0 || null); band.applyMutes();
}
const beatMs = () => 60000 / S.arr.bpm;
const turnMs = () => 4 * beatMs() * S.game.bars;
const leaderOf = k => { const o = order(); return o[((k % o.length) + o.length) % o.length]; };

// How long after they play you can hear it: their input delay, the slowest
// arrival of the last 15 seconds (real internet spikes every few seconds), and
// headroom. In BARS waiting longer costs nothing, arriving late sounds robotic,
// so this is generous, and it grows by itself if their audio still arrives late.
function delayFor(id){
  const p = room.peers.get(id); if(!p) return 150;
  const ages = [...(p.ages || [])].sort((a, b) => a - b);
  const recent = ages.length > 20 ? ages[Math.floor(ages.length * 0.98)] : (p.rtt || 150) / 2 + 20;
  const worst = Math.max(recent, ...(p.maxes || []));
  const late = ((audio.stats.players || {})[id] || {}).late || 0;
  if(late > (p.lateSeen || 0)) p.bump = Math.min(400, (p.bump || 0) + 40);
  else p.bump = Math.max(0, (p.bump || 0) - 20);   // a clean turn: give some back, so one bad patch doesn't add delay for good   // some arrived late since last turn: wait a bit longer
  p.lateSeen = late;
  return Math.min(2000, Math.max(20, (p.inMs || 0) + worst + 60 + (p.bump || 0)));
}
// When their band's position 0 sounds, on my clock (they tell everyone; see 'bs').
// Only trust a start they announced for this same song start (base): one from just
// before their band re-timed its start would line this band up wrong.
const startOf = (id, prev) => {
  const p = room.peers.get(id), st = band.started;
  let raw = p && (prev ? p.bsPrev : p.bs);
  const base = p && (prev ? p.bsPrevBase : p.bsBase);
  if(raw != null && base != null && st && Math.abs(base - p.offset - st.base) > 30) raw = null;
  return raw == null ? (prev ? null : st.base) : raw - p.offset;
};

// Incoming audio: play the soloist exactly `follow` ms after they played it
// (on the beat, since this band runs that much behind theirs); drop everyone else.
// Handovers are smooth: the outgoing soloist fades over the first beat of the next
// turn (their last notes ring), the incoming one fades in over the half beat
// before their turn (pickup notes come through).
const gainIn = (id, played, start) => {
  if(start == null) return 0;
  const seg = turnMs(), beat = beatMs(), pos = played - start; if(pos < 0) return 0;
  const k = Math.floor(pos / seg), into = pos - k * seg;
  if(leaderOf(k) === id) return 1;
  if(leaderOf(k - 1) === id && into < beat) return 1 - into / beat;
  if(leaderOf(k + 1) === id && seg - into < beat / 2) return 1 - (seg - into) / (beat / 2);
  return 0;
};
room.setRoute((id, capturedAt, p, planes) => {
  if(!active() || capturedAt == null) return undefined;
  const d = follow.get(id); if(d == null) return null;
  const played = capturedAt - (p.inMs || 0), n = planes ? planes[0].length : 128, blockMs = n / 48;
  const g = t => Math.max(gainIn(id, t, startOf(id)), gainIn(id, t, startOf(id, true)));
  const g0 = g(played), g1 = g(played + blockMs);
  if(g0 <= 0 && g1 <= 0) return null;
  if(planes && (g0 < 1 || g1 < 1)) for(const pl of planes) for(let i = 0; i < n; i++) pl[i] *= g0 + (g1 - g0) * i / n;
  return played + d;
});

// A soloist who drops out (left, or no audio arriving for a second and a half)
// mid-turn: the AI band takes the rest of the turn from the next bar line, so
// the groove never stops. Each device decides for itself what it can't hear.
let filling = null;
function fillDropped(k, lead, st){
  if(lead === me.id || lead === AI){ return; }
  const p = room.peers.get(lead), now = clk();
  if(p){ if(p.recv !== p.recvSeen){ p.recvSeen = p.recv; p.recvAt = now; } }
  const silent = !p || now - (p.recvAt || now) > 1500;
  if(filling && filling.k === k){ if(!silent){ soloist.stop(); filling = null; } return; }   // they're back: hand it back
  if(!silent || (filling && filling.k === k)) return;
  const bar = 4 * beatMs(), turnStart = st.zero + k * turnMs(), barsDone = Math.ceil((now + 150 - turnStart) / bar);
  const left = S.game.bars - barsDone; if(left < 1) return;
  filling = { k };
  soloist.play({ startMs: turnStart + barsDone * bar, bars: left, sixteenthMs: beatMs() / 4, seed: seedOf(k) });
}
export const fillingTurn = () => filling && filling.k;

// The AI soloist's ear: the audio of whoever's turn it is, placed on this band's 16th-note grid.
room.taps.listen = (id, planes, when) => {
  if(!active() || !order().includes(AI)) return;
  const st = band.started, who = id === 'me' ? me.id : id, pos = when - st.zero;
  if(pos < 0 || leaderOf(Math.floor(pos / turnMs())) !== who) return;
  soloist.feed(who, planes, when, ms => (ms - st.zero) / (beatMs() / 4));
};
const seedOf = k => { let h = 2166136261; for(const c of String((S.arr.pack && S.arr.pack.id) || S.arr.title) + ':' + k) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function tick(){
  const st = band.started;
  if(!S.playing || !st || !S.arr){ prepared = null; follow.clear(); onLeader(null); soloist.stop(); hooks.onTurn(null); return; }
  if(trading() && order().includes(AI)) soloist.prepare();   // load its amp before its first turn
  if(st !== lastStarted){ lastStarted = st; prepared = null; follow.clear(); }   // a new song or restart
  const now = clk(), pos = now - st.zero, seg = trading() ? turnMs() : 4 * beatMs();
  const cur = pos < 0 ? -1 : Math.floor(pos / seg), k = cur + 1, mk = S.game.mode + S.game.bars;
  if(!prepared || prepared.mk !== mk) prepared = { mk, k: -1 };
  // already inside a turn this device never lined up for (the band started late here,
  // or the game just changed): line up now, or the soloist isn't heard for the whole turn
  if(cur >= 0 && prepared.k < cur){ prepared.k = cur; prepare(cur, cur * seg); }
  if(st.zero + k * seg - now < AHEAD && prepared.k < k){ prepared.k = k; prepare(k, k * seg); }
  if(trading() && cur >= 0) fillDropped(cur, leaderOf(cur), st);
  if(filling && (!trading() || cur !== filling.k)) filling = null;
  const t = info(); onLeader(t.leader || null);
  hooks.onTurn(t);
}

// Line this band up for the turn starting at boundary (ms into the song).
function prepare(k, boundary){
  const st = band.started;
  let target = st.zero;
  if(!trading()) target = st.base;   // free jam: everyone on the room's shared timing
  else {
    const lead = leaderOf(k);
    if(lead !== me.id && lead !== AI){ const d = delayFor(lead); follow.set(lead, d); target = startOf(lead) + d; }
    // the band's turn: the AI soloist answers, starting on the bar line
    if(lead === AI) soloist.play({ startMs: st.zero + boundary, bars: S.game.bars, sixteenthMs: beatMs() / 4, seed: seedOf(k) });
  }
  if(Math.abs(target - st.zero) > 1){ band.shiftStart(boundary, target); tellStart(); }
}

const tellStart = () => { if(band.started) room.send({ t:'bs', start: band.started.zero, base: band.started.base }); };
// 'bs': another player's band start (their clock). Returns true if handled.
export function handle(m, id){
  if(m.t !== 'bs') return false;
  const p = room.peers.get(id); if(!p) return true;
  if(p.bs != null && Math.abs(p.bs - m.start) > 1){ p.bsPrev = p.bs; p.bsPrevBase = p.bsBase; }
  p.bs = m.start; p.bsBase = m.base; return true;
}

// What the screen shows: whose turn it is (as you hear it), who's next, and a
// countdown in the bar before your turn.
export function info(){
  const st = band.started; if(!st || !S.arr || !trading()) return { mode: S.game.mode };
  const now = clk(), pos = now - st.zero, seg = turnMs(), k = Math.floor(pos / seg);
  const next = pos < 0 ? 0 : k + 1, untilNext = st.zero + next * seg - now;
  const count = leaderOf(next) === me.id && untilNext <= 4 * beatMs() ? Math.ceil(untilNext / beatMs()) : 0;
  const progress = pos < 0 ? 0 : (pos - k * seg) / seg;   // how far through this turn (the turn bar's lights)
  return { mode: 'trade', bars: S.game.bars, leader: pos < 0 ? null : leaderOf(k), next: leaderOf(next), mine: pos >= 0 && leaderOf(k) === me.id, count, nameOf,
    progress, bar: pos < 0 ? 0 : Math.floor(progress * S.game.bars) + 1, covering: !!filling && filling.k === k };
}

export function start(){
  setInterval(tick, 50);
  bsTimer = setInterval(() => { if(S.playing) tellStart(); }, 1000);
}
