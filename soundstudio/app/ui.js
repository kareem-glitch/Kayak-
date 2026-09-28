// Everything on screen: video tiles, band panel, beat display, part meters,
// device pickers and the connection panel.
import { $, clamp } from './util.js';
import { S, me } from './state.js';
import { STYLES, DESC } from './band/theory.js';
import * as band from './band/engine.js';
import * as session from './session.js';

export const tiles = new Map();
export function tileFor(p){
  let t = tiles.get(p.identity);
  if(!t){
    t = document.createElement('div'); t.className = 'tile' + (p.identity === me.id ? ' me' : '');
    t.innerHTML = '<div class="vid"></div><div class="initial"></div><span class="tname"></span><span class="badge" hidden>Running the band</span>';
    $('#grid').appendChild(t); tiles.set(p.identity, t);
  }
  const n = p.name || p.identity;
  t.querySelector('.initial').textContent = n.slice(0, 1).toUpperCase();
  t.querySelector('.tname').textContent = n + (p.identity === me.id ? ' (you)' : '');
  t.querySelector('.badge').hidden = p.identity !== S.hostId;
  return t;
}
export function removeTile(id){ tiles.get(id)?.remove(); tiles.delete(id); }
export function showVideoIn(t, stream){ const v = document.createElement('video'); v.autoplay = v.playsInline = v.muted = true; v.srcObject = stream; t.querySelector('.vid').replaceChildren(v); t.querySelector('.initial').hidden = true; }

export function showBeat(m){
  document.querySelectorAll('#beats span').forEach((el, i) => el.classList.toggle('on', i === m.beat));
  $('#countNum').textContent = m.count ? String(m.count) : '';
  const idx = m.chord;
  document.querySelectorAll('#chords li').forEach((el, i) => el.classList.toggle('now', i === idx));
  $('#nowChord').textContent = (idx !== undefined && S.arr && S.arr.chords[idx]) ? S.arr.chords[idx].name : '';
}
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
  tiles.forEach((t, id) => t.querySelector('.badge').hidden = id !== S.hostId);
  $('#claimBox').hidden = hostHere;
  $('#hostControls').hidden = !hostHere;
  $('#transport').hidden = !hostHere || !a;
  $('#claimBtn').disabled = !!S.hostId && !hostHere;
  $('#claimStatus').textContent = S.hostId && !hostHere ? S.hostName + ' is running the band.' : '';
  $('#bandTileTitle').textContent = S.hostId ? (a ? a.title + (S.playing ? '' : ' (stopped)') : S.hostName + ' is setting up the band') : 'The band is waiting for someone to run it';
  $('#arrTitle').textContent = a ? a.title : 'No band yet';
  $('#arrNotes').textContent = a ? a.notes : ''; $('#arrNotes').hidden = !(a && a.notes);
  const facts = $('#facts'); facts.innerHTML = '';
  if(a) [styleLabel(a.style), a.key, a.bpm + ' bpm', a.engine === 'lyria' ? 'Google Lyria band' : a.engine === 'stems' ? (a.pack.source === 'stock' ? 'Stock track' : 'Your track') : (a.swing ? 'Swung' : 'Straight')].forEach(x => { const s = document.createElement('span'); s.textContent = x; facts.appendChild(s); });
  const ol = $('#chords'); ol.innerHTML = '';
  if(a && (!a.engine || a.engine === 'tone')) a.chords.forEach(c => { const li = document.createElement('li'); li.textContent = c.name + (c.bars > 1 ? ' ×' + c.bars : ''); ol.appendChild(li); });
  if(a && hostHere) $('#bpm').value = a.bpm;
  $('#bpm').disabled = !!(a && a.engine === 'stems');   // recorded parts keep their tempo
  $('#countIn').closest('label').hidden = !!(a && a.engine && a.engine !== 'tone');
  $('#playIcon').innerHTML = S.playing ? '<rect x="6" y="6" width="12" height="12" rx="1.5"/>' : '<path d="M7 4.5v15l13-7.5z"/>';
  $('#playBtn').setAttribute('aria-label', S.playing ? 'Stop' : 'Play');
  document.querySelectorAll('[data-game]').forEach(b => { b.setAttribute('aria-checked', String(S.game.mode === 'free' ? b.dataset.game === 'free' : b.dataset.game === String(S.game.bars))); if(b.dataset.game !== 'free') b.disabled = !(a && (a.engine === 'stems' || a.engine === 'lyria')); });
  $('#keepAI').checked = !!S.game.ai; $('#keepAI').closest('label').hidden = S.game.mode !== 'trade';
  $('#gameNote').textContent = S.game.mode === 'trade' ? 'BARS: take turns trading bars. Only whoever’s on is heard, and it lands on the beat at any distance. Took a seat? The AI plays your part until it’s your turn.' : 'Everyone plays at once. Best when you’re all fairly close.';
  const box = $('#strips'); box.innerHTML = '';
  S.seats.forEach(s => {
    const d = partDesc(s.id), off = d === null && !s.human && !!a;
    const el = document.createElement('div'); el.className = 'strip' + (s.human ? ' human' : '') + (off ? ' off' : '');
    const head = document.createElement('div');
    const nm = document.createElement('span'); nm.className = 'strip-name'; nm.textContent = s.label;
    const st = document.createElement('span'); st.className = 'strip-status';
    st.textContent = s.human ? 'Played by ' + (s.who || 'a human') : !a ? 'Waiting for the band' : off ? 'Sitting out in this style' : 'AI playing ' + d;
    head.append(nm, st);
    const btn = document.createElement('button'); btn.className = 'seat';
    const mine = s.human && s.who === me.name;
    btn.textContent = s.human ? (mine || me.isHost ? 'Hand back to AI' : 'Taken') : "I'll play this";
    btn.disabled = !S.hostId || (s.human && !mine && !me.isHost);
    btn.onclick = () => session.toggleSeat(s.id);
    el.append(head, btn);
    if(me.isHost){
      const v = document.createElement('label'); v.className = 'vol'; v.textContent = 'Level';
      const r = document.createElement('input'); r.type = 'range'; r.min = -30; r.max = 6; r.value = S.levels[s.id] || 0;
      r.setAttribute('aria-label', s.label + ' level');
      r.oninput = () => session.setLevel(s.id, +r.value);
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

// Trade bars: who's on (glowing tile), who's next, and a countdown to your turn.
export function showTurn(t){
  const line = $('#turnLine');
  if(!t || t.mode !== 'trade'){ line.hidden = !(S.game.mode === 'trade'); line.textContent = S.game.mode === 'trade' ? `BARS: ${S.game.bars} each. Starts with the band.` : ''; tiles.forEach(el => el.classList.remove('onmic', 'next')); $('#bandTile').classList.remove('onmic', 'next'); $('#turnCount').textContent = ''; return; }
  line.hidden = false;
  line.textContent = t.mine ? `Your ${t.bars} bars` : t.leader ? `${t.nameOf(t.leader)} is on` : `BARS: ${t.bars} each`;
  if(t.next && t.next !== t.leader) line.textContent += ` · next: ${t.next === me.id ? 'you' : t.nameOf(t.next)}`;
  tiles.forEach((el, id) => { el.classList.toggle('onmic', id === t.leader); el.classList.toggle('next', id === t.next && id !== t.leader); });
  $('#bandTile').classList.toggle('onmic', t.leader === 'ai'); $('#bandTile').classList.toggle('next', t.next === 'ai' && t.leader !== 'ai');
  $('#turnCount').textContent = t.count ? String(t.count) : '';
}
export function status(text){ $('#connStats').textContent = text; }
export function fillSelect(sel, list, preferred){
  const cur = sel.value || preferred;
  sel.replaceChildren(...list.map(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.label; return o; }));
  if([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
