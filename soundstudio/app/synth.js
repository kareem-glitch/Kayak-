// The pocket synth: a mono lead you play on screen, for jamming from a phone
// when you've no instrument with you. A keyboard, every note side by side,
// with the song's scale marked (the same scale the AI soloist uses). Slide
// your finger across to glide between notes; hold one and it grows a vibrato.
// It goes to the room as your input (your mic is muted while it's on) and
// you hear it straight away.
import { S } from './state.js';
import { scaleFor } from './band/phrase.js';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const BLACK = [1, 3, 6, 8, 10];
const KEYS = 'awsedftgyhujk';   // on a laptop, like a DAW: A = C, W = C#, S = D ... K = the C above

// The keyboard: every note, side by side, like a piano, from `from` for `octaves`
// octaves (plus the top C). Notes in the song's scale are marked.
export function keysFor(key, style, from = 60, octaves = 1){
  const sc = scaleFor(key, style), out = [];
  for(let m = from; m <= from + 12 * octaves; m++){
    const pc = m % 12;
    out.push({ midi: m, name: NAMES[pc], black: BLACK.includes(pc), inKey: sc.steps.includes(((pc - sc.root) % 12 + 12) % 12), root: pc === sc.root });
  }
  return out;
}

let voice = null, held = [], panel = null, keyShown = '', lowC = 60;
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

// One voice for the whole jam: two slightly detuned saws through a filter that
// opens on each note, and a gentle delayed vibrato.
function build(ctx, out){
  const a = ctx.createOscillator(), b = ctx.createOscillator(), f = ctx.createBiquadFilter(), amp = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
  a.type = b.type = 'sawtooth'; b.detune.value = 8;
  f.type = 'lowpass'; f.Q.value = 5; f.frequency.value = 900;
  amp.gain.value = 0;
  lfo.frequency.value = 5.5; depth.gain.value = 0; lfo.connect(depth); depth.connect(a.detune); depth.connect(b.detune);
  a.connect(f); b.connect(f); f.connect(amp); amp.connect(out);
  [a, b, lfo].forEach(o => o.start());
  return { ctx, a, b, f, amp, depth, stopAll(){ [a, b, lfo].forEach(o => { try{ o.stop(); }catch(e){} }); amp.disconnect(); } };
}

function sound(midi, legato){
  const { ctx, a, b, f, amp, depth } = voice, t = ctx.currentTime, glide = legato ? 0.045 : 0.004;
  [a, b].forEach(o => { o.frequency.cancelScheduledValues(t); o.frequency.setTargetAtTime(hz(midi), t, glide / 3); });
  depth.gain.cancelScheduledValues(t); depth.gain.setValueAtTime(0, t); depth.gain.setTargetAtTime(14, t + 0.35, 0.25);
  if(!legato){
    amp.gain.cancelScheduledValues(t); amp.gain.setTargetAtTime(0.32, t, 0.004);
    f.frequency.cancelScheduledValues(t); f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(4200, t + 0.012); f.frequency.setTargetAtTime(1800, t + 0.012, 0.18);
  }
}
function silence(){ const { ctx, amp, depth } = voice, t = ctx.currentTime; amp.gain.cancelScheduledValues(t); amp.gain.setTargetAtTime(0, t, 0.04); depth.gain.setTargetAtTime(0, t, 0.05); }

// Mono, last note wins: let go and it falls back to a note you're still holding.
function down(id, midi){ held = held.filter(h => h.id !== id); const legato = held.length > 0; held.push({ id, midi }); sound(midi, legato); light(); }
function up(id){ const was = held.length && held[held.length - 1].id === id; held = held.filter(h => h.id !== id); if(!held.length) silence(); else if(was) sound(held[held.length - 1].midi, true); light(); }
function move(id, midi){ const h = held.find(h => h.id === id); if(!h || h.midi === midi) return; h.midi = midi; if(held[held.length - 1] === h) sound(midi, true); light(); }
const light = () => panel && panel.querySelectorAll('[data-midi]').forEach(p => p.classList.toggle('on', held.length > 0 && +p.dataset.midi === held[held.length - 1].midi));

const octaves = () => panel && panel.clientWidth >= 640 ? 2 : 1;
function render(force){
  const arr = S.arr || {}, k = [arr.key, arr.style, lowC, octaves()].join('|');
  if(k === keyShown && !force) return; keyShown = k;
  panel.querySelector('.synth-key').textContent = arr.key || 'E minor';
  panel.querySelector('.synth-oct').textContent = 'C' + (lowC / 12 - 1);
  const board = panel.querySelector('.synth-pads'), keys = keysFor(arr.key, arr.style, lowC, octaves()), whites = keys.filter(n => !n.black).length;
  board.innerHTML = ''; board.style.setProperty('--whites', whites);
  let w = 0;
  keys.forEach(n => {
    const el = document.createElement('div');
    el.className = 'key ' + (n.black ? 'black' : 'white') + (n.inKey ? ' in' : '') + (n.root ? ' root' : ''); el.dataset.midi = n.midi;
    if(n.black) el.style.setProperty('--at', w); else { el.style.setProperty('--i', w); w++; }
    const li = KEYS[n.midi - lowC]; el.innerHTML = `<span class="nm">${n.name}</span>` + (li ? `<span class="kb">${li.toUpperCase()}</span>` : '');
    board.appendChild(el);
  });
  light();
}
export function shift(dir){ lowC = Math.max(36, Math.min(84, lowC + 12 * dir)); render(true); }

// Touch/mouse: one pointer per finger; sliding onto another pad glides to it.
function wire(){
  const grid = panel.querySelector('.synth-pads'), padAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest && el.closest('[data-midi]'); };
  grid.addEventListener('pointerdown', e => { const p = padAt(e.clientX, e.clientY); if(!p || !voice) return; e.preventDefault(); grid.setPointerCapture(e.pointerId); down('p' + e.pointerId, +p.dataset.midi); });
  grid.addEventListener('pointermove', e => { if(!voice) return; const p = padAt(e.clientX, e.clientY); if(p) move('p' + e.pointerId, +p.dataset.midi); });
  ['pointerup', 'pointercancel'].forEach(t => grid.addEventListener(t, e => voice && up('p' + e.pointerId)));
  window.addEventListener('keydown', e => {
    if(!voice || e.repeat || e.metaKey || e.ctrlKey || /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase(), i = KEYS.indexOf(k);
    if(k === 'z' || k === 'x'){ shift(k === 'z' ? -1 : 1); return; }
    if(i < 0) return; down('k' + k, lowC + i); e.preventDefault();
  });
  panel.querySelectorAll('[data-oct]').forEach(b => b.onclick = () => shift(+b.dataset.oct));
  window.addEventListener('resize', () => voice && render());
  window.addEventListener('keyup', e => { if(voice) up('k' + e.key.toLowerCase()); });
}

let timer = null;
// Turn it on: `ctx` is the jam's audio context, `toRoom` where your input goes, `toEars` your headphones.
export function start(el, ctx, toRoom, toEars){
  if(voice) return;
  if(!panel){ panel = el; wire(); }
  const out = ctx.createGain(); out.connect(toRoom); out.connect(toEars);
  voice = build(ctx, out); voice.out = out; held = [];
  keyShown = ''; render(); timer = setInterval(render, 1000);   // follows the song's key
  panel.hidden = false;
}
export function stop(){
  if(!voice) return;
  voice.stopAll(); voice.out.disconnect(); voice = null; held = []; clearInterval(timer);
  if(panel) panel.hidden = true;
}
export const isOn = () => !!voice;
// For tests: play a pad by note number.
export const press = midi => voice && down('t', midi), release = () => voice && up('t');
