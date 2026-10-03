// Everything on screen: the stage (the players as a grid of tiles, under the
// chord screen and the turn bar),
// band panel, part meters, device pickers and the connection panel.
import { $, clamp } from './util.js';
import { S, me } from './state.js';
import { STYLES, DESC, transposeName } from './band/theory.js';
import * as band from './band/engine.js';
import * as session from './session.js';
import { PAD } from './avatar-colors.js';
import { muted } from './presence.js';
import * as stems from './band/stems.js';

export const tiles = new Map();
export function tileFor(p){
  let t = tiles.get(p.identity);
  if(!t){
    t = document.createElement('div'); t.className = 'tile' + (p.identity === me.id ? ' me' : '');
    t.innerHTML = '<div class="vid"></div><div class="person" aria-hidden="true"><svg viewBox="0 0 100 100"><rect x="32" y="4" width="36" height="36" rx="13"/><path d="M14 100V72c0-12 9-22 21-22h30c12 0 21 10 21 22v28z"/></svg></div><div class="initial"></div><span class="tname"></span>';   // person: shown when the camera is off
    tiles.set(p.identity, t);
  }
  const n = p.name || p.identity;
  t.dataset.name = n;
  t.querySelector('.initial').textContent = n.slice(0, 1).toUpperCase();
  t.querySelector('.tname').textContent = n + (p.identity === me.id ? ' (you)' : '');
  placeSpots();
  return t;
}
export function removeTile(id){ tiles.get(id)?.remove(); tiles.delete(id); placeSpots(); }

// ---- the stage: the players as a grid of tiles ----
// Only who's really playing gets a tile: the people in the room (in the order
// they joined, left to right, then a new row), then the AI band's parts that
// are in the track, not taken by someone and not turned all the way off.
// People with their mic muted are greyed out. Up to 4 across (2 on a phone).
const spots = new Map();
function spotEl(key, button){
  let sp = spots.get(key);
  if(!sp){
    sp = document.createElement(button ? 'button' : 'div'); if(button) sp.type = 'button';
    sp.className = 'spot';
    sp.innerHTML = '<span class="floor"></span><span class="fig"></span><span class="tag"><i class="pad"></i><span class="who"></span><span class="role"></span><span class="inst"></span></span>';
    spots.set(key, sp);
  }
  return sp;
}
function stand(sp, tile){
  const fig = sp.querySelector('.fig');
  if(tile){ if(tile.parentElement !== fig){ fig.replaceChildren(tile); const v = tile.querySelector('video'); if(v) v.play().catch(() => {}); } }
  else if(fig.querySelector('.tile')) fig.replaceChildren();
}
function label(sp, who, role){
  sp.querySelector('.who').textContent = who;
  const r = sp.querySelector('.role'); r.textContent = role; r.className = 'role' + (role ? ' ' + role.toLowerCase() : '');
}
const phone = () => matchMedia('(max-width:860px)').matches;
export function placeSpots(){
  const grid = $('#players'); if(!grid) return;
  const a = S.arr, list = [];
  tiles.forEach((t, id) => {   // everyone in the room, on their part (any number per part) or none
    const s = S.seats.find(x => session.holders(x).includes(t.dataset.name));
    list.push({ key: (s ? 'seat:' + s.id + ':' : 'free:') + id, seat: s, person: [id, t] });
  });
  S.seats.forEach(s => {
    if(!s.human && a && S.hostId && partDesc(s.id) !== null && ((S.levels || {})[s.id] ?? 0) > -30) list.push({ key: 'seat:' + s.id, seat: s });   // the AI plays it (turned all the way off: it's gone)
  });
  const n = list.length, cols = Math.max(1, Math.min(n, phone() ? 2 : 4));
  grid.style.setProperty('--cols', cols); grid.style.setProperty('--rows', Math.max(1, Math.ceil(n / cols)));
  const used = new Set();
  list.forEach((m, i) => {
    const s = m.seat, sp = spotEl(m.key, !!s); used.add(m.key);
    if(grid.children[i] !== sp) grid.insertBefore(sp, grid.children[i] || null);
    const id = m.person && m.person[0], mine = id === me.id;
    stand(sp, m.person && m.person[1]);
    if(id) sp.dataset.who = id; else delete sp.dataset.who;
    sp.classList.toggle('ai', !m.person); sp.classList.toggle('mine', mine);
    sp.classList.toggle('muted', m.person ? muted.has(id) : stems.localOff.has(s.id));
    sp.style.setProperty('--pad', s ? PAD[s.id] || '#ececea' : '#ececea');
    if(s){
      const part = s.label.replace('Rhythm guitar', 'Guitar');
      sp.dataset.seat = s.id;
      label(sp, m.person ? m.person[1].dataset.name : part, m.person ? (mine ? 'YOU' : '') : 'AI');
      sp.querySelector('.inst').textContent = m.person ? part : '';
      const off = !m.person && stems.localOff.has(s.id);
      sp.title = m.person ? (mine ? 'Stop playing ' + part.toLowerCase() : me.isHost ? 'Take ' + m.person[1].dataset.name + ' off ' + part.toLowerCase() : 'Played by ' + m.person[1].dataset.name)
        : off ? 'Muted just for you: tap to bring the ' + part.toLowerCase() + ' back' : 'Tap to mute the AI ' + part.toLowerCase() + ' (just for you)';
      sp.disabled = m.person ? !S.hostId || (!mine && !me.isHost) : false;
      // tap an AI player to mute it on your device (tap again to bring it back); taking a part is in the Band drawer
      sp.onclick = () => {
        if(!m.person){ if(stems.localOff.has(s.id)) stems.localOff.delete(s.id); else stems.localOff.add(s.id); band.applyMutes(); placeSpots(); return; }
        m.person && !mine ? session.setSeat(s.id, false, m.person[1].dataset.name) : session.toggleSeat(s.id);
      };
    } else {
      delete sp.dataset.seat; label(sp, m.person[1].dataset.name, mine ? 'YOU' : ''); sp.querySelector('.inst').textContent = '';
    }
  });
  spots.forEach((sp, key) => { if(!used.has(key)){ sp.remove(); spots.delete(key); } });
}
addEventListener('resize', () => placeSpots());
export function showVideoIn(t, stream){ const v = document.createElement('video'); v.autoplay = v.playsInline = v.muted = true; v.srcObject = stream; t.querySelector('.vid').replaceChildren(v); t.querySelector('.initial').hidden = true; }

let beatNow = null;
export function showBeat(m){
  document.querySelectorAll('#beats span').forEach((el, i) => el.classList.toggle('on', i === m.beat));
  beatNow = m.beat ?? null;
  if(!(S.game.mode === 'trade' && S.playing)){   // free jam: the step lights walk the bar
    setLeds(4, beatNow == null ? 0 : (beatNow + 1) / 4);
    if(S.playing && beatNow != null){ $('#turnCount').textContent = String(beatNow + 1); $('#turnOf').textContent = '/4'; }
  }
  $('#countNum').textContent = m.count ? String(m.count) : '';
  const idx = m.chord;
  document.querySelectorAll('#chords li').forEach((el, i) => el.classList.toggle('now', i === idx));
  $('#nowChord').textContent = (idx !== undefined && S.arr && S.arr.chords[idx]) ? transposeName(S.arr.chords[idx].name, S.arr.transpose || 0) : bandFace();
}
// Recorded tracks have no chord chart: the band tile shows the key and tempo instead.
// The band display's key and tempo, changeable by whoever runs the band (tap the display)
export const keyLabel = t => { const a = S.arr, base = a.baseKey || a.key; return shortKey(transposeName(base, t)) + (t ? ` (${t > 0 ? '+' : ''}${t})` : ''); };
export function showPop(){
  const a = S.arr; if(!a) { $('#lcdPop').hidden = true; return; }
  const t = a.transpose || 0;
  $('#popKey').textContent = keyLabel(t);
  $('#popBpm').textContent = a.bpm;
  const host = S.hostId === me.id;
  document.querySelectorAll('#lcdPop button').forEach(b => { b.disabled = !host || a.engine === 'lyria'; });
  $('#popNote').textContent = !host ? `${S.hostName || 'Whoever runs the band'} can change these.` : a.engine === 'lyria' ? 'The live AI band can’t be transposed or re-timed.' : 'Drums keep their pitch. Everyone hears the change.';
}
const shortKey = k => String(k || '').replace(/\s*major$/i, '').replace(/\s*minor$/i, 'm');
const bandFace = () => S.arr && S.arr.engine !== 'tone' && (!S.arr.chords || !S.arr.chords.length) ? `${shortKey(S.arr.key)} · ${S.arr.bpm}` : '';
const styleLabel = st => (STYLES[st] && STYLES[st].label) || String(st || '').replace(/^\w/, c => c.toUpperCase());
const STEM_OF = { drums:'drums', bass:'bass', keys:'piano', guitar:'guitar' };
function partDesc(id){
  if(!S.arr) return null;
  if(S.arr.engine === 'stems') return S.arr.pack.parts.includes(STEM_OF[id]) ? 'Recorded part' : null;   // absent parts show as not in this track
  if(id === 'drums') return styleLabel(S.arr.style) + ' groove';
  const t = S.arr[id]; return t === 'off' ? null : DESC[t];
}

export function render(){
  const a = S.arr, hostHere = me.isHost;
  $('#claimBox').hidden = hostHere;
  $('#hostControls').hidden = !hostHere;
  $('#transport').hidden = !hostHere || !a;
  // the bottom bar: the track, play (the band's host only), the game
  $('#playBtn').disabled = !hostHere || !a;
  $('#dockTitle').textContent = a ? a.title : S.hostId ? S.hostName + ' is choosing a track' : 'No band yet';
  $('#dockMeta').textContent = a ? [a.key, a.bpm + ' bpm', S.hostId && !hostHere ? 'run by ' + S.hostName : ''].filter(Boolean).join(' · ') : 'Pick a track in Band';
  $('#gameBadge').textContent = S.game.mode === 'trade' ? `BARS ${S.game.bars}` : 'Free jam';
  $('#claimBtn').disabled = !!S.hostId && !hostHere;
  $('#claimStatus').textContent = S.hostId && !hostHere ? S.hostName + ' is running the band.' : '';
  $('#bandTileTitle').textContent = S.hostId ? (a ? a.title + (S.playing ? '' : ' (stopped)') : S.hostName + ' is setting up the band') : 'The band is waiting for someone to run it';
  $('#arrTitle').textContent = a ? a.title : 'No band yet';
  if(!$('#nowChord').textContent || !S.playing) $('#nowChord').textContent = bandFace();
  $('#arrNotes').textContent = a ? a.notes : ''; $('#arrNotes').hidden = !(a && a.notes);
  const facts = $('#facts'); facts.innerHTML = '';
  if(a) [styleLabel(a.style), a.key, a.bpm + ' bpm', a.engine === 'lyria' ? 'Google Lyria band' : a.engine === 'stems' ? (a.pack.source === 'stock' ? 'Stock track' : 'Your track') : (a.swing ? 'Swung' : 'Straight')].forEach(x => { const s = document.createElement('span'); s.textContent = x; facts.appendChild(s); });
  const ol = $('#chords'); ol.innerHTML = '';
  if(a && (!a.engine || a.engine === 'tone')) a.chords.forEach(c => { const li = document.createElement('li'); li.textContent = c.name + (c.bars > 1 ? ' ×' + c.bars : ''); ol.appendChild(li); });
  if(a && hostHere) $('#bpm').value = a.bpm;
  showPop();
  $('#countIn').closest('label').hidden = !!(a && a.engine && a.engine !== 'tone');
  $('#playIcon').innerHTML = S.playing ? '<rect x="6" y="6" width="12" height="12" rx="1.5"/>' : '<path d="M7 4.5v15l13-7.5z"/>';
  $('#playBtn').setAttribute('aria-label', S.playing ? 'Stop' : 'Play');
  document.querySelectorAll('[data-game]').forEach(b => { b.setAttribute('aria-checked', String(S.game.mode === 'free' ? b.dataset.game === 'free' : b.dataset.game === String(S.game.bars))); b.disabled = !hostHere || (b.dataset.game !== 'free' && !(a && (a.engine === 'stems' || a.engine === 'lyria'))); });
  $('#keepAI').checked = !!S.game.ai; $('#keepAIRow').hidden = S.game.mode !== 'trade' || !hostHere;
  $('#gameNote').textContent = S.game.mode === 'trade' ? 'BARS: take turns trading bars. Only whoever’s on is heard, and it lands on the beat at any distance. Took a seat? The AI plays your part until it’s your turn.' : 'Everyone plays at once. Best when you’re all fairly close.';
  placeSpots();   // the players' tiles: tap a part to play it
  const box = $('#strips'); box.innerHTML = '';
  // everyone picks their part here; the band's host also balances the levels
  S.seats.forEach(s => {
    const d = partDesc(s.id), off = d === null && !s.human && !!a;
    const el = document.createElement('div'); el.className = 'strip' + (s.human ? ' human' : '') + (off ? ' off' : '');
    const head = document.createElement('div');
    const nm = document.createElement('span'); nm.className = 'strip-name'; nm.textContent = s.label;
    const st = document.createElement('span'); st.className = 'strip-status';
    st.textContent = s.human ? 'Played by ' + session.holders(s).join(', ') : !a ? 'Waiting for the band' : off ? 'Sitting out in this style' : 'AI playing ' + d;
    head.append(nm, st);
    const btn = document.createElement('button'); btn.className = 'seat'; btn.dataset.take = s.id;
    const mine = session.holders(s).includes(me.name);   // anyone can join a part others play too
    btn.textContent = mine ? 'Stop playing' : me.isHost && s.human ? 'Hand back to AI' : "I'll play this";
    btn.disabled = !S.hostId;
    btn.onclick = () => !mine && me.isHost && s.human ? session.clearSeat(s.id) : session.toggleSeat(s.id);
    el.append(head, btn);
    if(me.isHost){
      const v = document.createElement('label'); v.className = 'vol'; v.textContent = 'Level';
      const r = document.createElement('input'); r.type = 'range'; r.min = -30; r.max = 6; r.value = S.levels[s.id] || 0;
      r.setAttribute('aria-label', s.label + ' level');
      r.oninput = () => { session.setLevel(s.id, +r.value); placeSpots(); };
      v.appendChild(r); el.appendChild(v);
      const m = document.createElement('div'); m.className = 'meter'; m.innerHTML = `<i data-meter="${s.id}"></i>`; el.appendChild(m);
    }
    box.appendChild(el);
  });
  if(S.playing && me.isHost && !render.metering){ render.metering = true; requestAnimationFrame(meterLoop); }
}
function meterLoop(){
  if(!S.playing || !band.engine()){ render.metering = false; return; }
  S.seats.forEach(s => { const el = document.querySelector(`[data-meter="${s.id}"]`); if(!el) return; const db = band.partLevel(s.id); el.style.width = (Number.isFinite(db) ? clamp((db + 54) / 54, 0, 1) * 100 : 0).toFixed(1) + '%'; });
  requestAnimationFrame(meterLoop);
}

// The turn bar: whose turn it is (BARS), how far through it (a row of step
// lights, one a beat, like the P-6's) and who's next; in free jam, the beat of the bar.
function setLeds(n, p){
  const row = $('#leds');
  if(row.children.length !== n) row.replaceChildren(...Array.from({ length: n }, (_, i) => { const e = document.createElement('i'); if(i && i % 4 === 0) e.className = 'bar'; return e; }));
  const lit = p > 0 ? Math.ceil(p * n - 1e-6) : 0;
  [...row.children].forEach((e, i) => e.classList.toggle('on', i < lit));
}
function glow(leader, next){
  tiles.forEach((el, id) => { el.classList.toggle('onmic', id === leader); el.classList.toggle('next', id === next && id !== leader); });
  spots.forEach(sp => {
    const who = sp.dataset.who, band = sp.classList.contains('ai');
    sp.classList.toggle('on', !!leader && (who ? who === leader : leader === 'ai' && band));
    sp.classList.toggle('next', !!next && next !== leader && (who ? who === next : next === 'ai' && band));
  });
  $('#bandTile').classList.toggle('onmic', leader === 'ai'); $('#bandTile').classList.toggle('next', next === 'ai' && leader !== 'ai');
}
export function showTurn(t){
  const line = $('#turnLine'), count = $('#turnCount'), of = $('#turnOf'), next = $('#turnNext'), bar = $('#turnBar');
  if(!t || t.mode !== 'trade'){
    glow(null, null); bar.classList.remove('countdown');
    const trade = S.game.mode === 'trade';
    line.textContent = trade ? `BARS ${S.game.bars}` : 'Free jam';
    if(!S.playing){ count.textContent = '–'; of.textContent = ''; setLeds(trade ? Math.min(32, S.game.bars * 4) : 4, 0); }
    next.textContent = S.playing ? '' : !S.arr ? 'Pick a track' : trade ? 'Starts with the band' : 'Press play';
    return;
  }
  line.textContent = t.mine ? `Your ${t.bars} bars` : t.covering ? `${t.nameOf(t.leader)} dropped: the band covers` : t.leader ? `${t.nameOf(t.leader)} is on` : `BARS ${t.bars}`;
  next.textContent = t.next && t.next !== t.leader ? 'next: ' + (t.next === me.id ? 'you' : t.nameOf(t.next)) : '';
  bar.classList.toggle('countdown', !!t.count);
  if(t.count){ count.textContent = String(t.count); of.textContent = ''; }   // your turn is coming: 4, 3, 2, 1
  else { count.textContent = t.bar ? String(t.bar) : '–'; of.textContent = t.bar ? '/' + t.bars : ''; }
  setLeds(Math.min(32, t.bars * 4), t.progress || 0);
  glow(t.leader, t.next);
}
export function status(text){ $('#connStats').textContent = text; }
// Something you need to see or do, shown on the stage (not in a closed drawer).
// action: { label, run } for a button; key: the same key replaces, and a dismissed key stays dismissed.
const dismissed = new Set(); let noticeKey = null;
export function notice(text, { action = null, key = text } = {}){
  if(dismissed.has(key)) return;
  noticeKey = key; $('#noticeText').textContent = text; $('#notice').hidden = false;
  const b = $('#noticeAct'); b.hidden = !action;
  if(action){ b.textContent = action.label; b.onclick = () => { clearNotice(key); action.run(); }; }
}
export function clearNotice(key){ if(key === undefined || key === noticeKey){ $('#notice').hidden = true; noticeKey = null; } }
$('#noticeClose').onclick = () => { if(noticeKey) dismissed.add(noticeKey); clearNotice(); };
export function fillSelect(sel, list, preferred){
  const cur = sel.value || preferred;
  sel.replaceChildren(...list.map(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.label; return o; }));
  if([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
