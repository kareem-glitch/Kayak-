// The pocket synth: a mono lead you play on screen, for jamming from a phone
// when you've no instrument with you. One row of cube keys: just the song's
// scale (every note fits, and the keys are big enough for thumbs) or every
// note. Slide your finger across to glide between notes; hold one and it
// grows a vibrato. It goes to the room as your input (your mic is muted while
// it's on) and you hear it straight away.
import { S } from './state.js';
import { scaleFor } from './band/phrase.js';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP = [1, 3, 6, 8, 10];
const CHROMATIC_KEYS = 'awsedftgyhujk';   // on a laptop, like a DAW: A = C, W = C#, S = D ... K = the C above
const SCALE_KEYS = 'asdfghjkl;';          // in-key mode: the home row, one key per cube

// The cubes, left to right. inKeyOnly: the scale from the root (and the root on
// top); otherwise every note from C. `from` is the C the range starts at.
export function keysFor(key, style, from = 60, octaves = 1, inKeyOnly = false){
  const sc = scaleFor(key, style), out = [], lo = inKeyOnly ? from + sc.root : from;
  for(let m = lo; m <= lo + 12 * octaves; m++){
    const pc = m % 12, inKey = sc.steps.includes(((pc - sc.root) % 12 + 12) % 12);
    if(inKeyOnly && !inKey) continue;
    out.push({ midi: m, name: NAMES[pc], sharp: SHARP.includes(pc), inKey, root: pc === sc.root });
  }
  return out;
}

let voice = null, held = [], panel = null, keyShown = '', lowC = 60, shown = [], inKeyOnly = null;
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

// One voice for the whole jam: two slightly detuned saws through a filter that
// opens on each note, and a gentle delayed vibrato. The attack is instant.
function build(ctx, out){
  const a = ctx.createOscillator(), b = ctx.createOscillator(), f = ctx.createBiquadFilter(), amp = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
  a.type = b.type = 'sawtooth'; b.detune.value = 8;
  f.type = 'lowpass'; f.Q.value = 5; f.frequency.value = 2600;
  amp.gain.value = 0;
  lfo.frequency.value = 5.5; depth.gain.value = 0; lfo.connect(depth); depth.connect(a.detune); depth.connect(b.detune);
  a.connect(f); b.connect(f); f.connect(amp); amp.connect(out);
  [a, b, lfo].forEach(o => o.start());
  return { ctx, a, b, f, amp, depth, stopAll(){ [a, b, lfo].forEach(o => { try{ o.stop(); }catch(e){} }); amp.disconnect(); } };
}

function sound(midi, legato){
  const { ctx, a, b, f, amp, depth } = voice, t = ctx.currentTime;
  [a, b].forEach(o => { o.frequency.cancelScheduledValues(t); if(legato) o.frequency.setTargetAtTime(hz(midi), t, 0.015); else o.frequency.setValueAtTime(hz(midi), t); });
  depth.gain.cancelScheduledValues(t); depth.gain.setValueAtTime(0, t); depth.gain.setTargetAtTime(14, t + 0.35, 0.25);
  if(!legato){
    // straight to full level and a bright pluck on the very first sample: nothing to wait for
    amp.gain.cancelScheduledValues(t); amp.gain.setValueAtTime(0.32, t);
    f.frequency.cancelScheduledValues(t); f.frequency.setValueAtTime(4800, t); f.frequency.setTargetAtTime(1800, t, 0.12);
  }
}
function silence(){ const { ctx, amp, depth } = voice, t = ctx.currentTime; amp.gain.cancelScheduledValues(t); amp.gain.setTargetAtTime(0, t, 0.03); depth.gain.setTargetAtTime(0, t, 0.05); }

// How long from your finger to your ears: the touch reaching the page, plus the
// audio output (the part Bluetooth headphones make huge). Shown on the panel.
let touchMs = [], lastShown = -1, measuredOut = null;
// After a speaker test: the measured round trip (speaker -> mic), about twice the output delay.
export function setMeasured(roundTripMs){ measuredOut = roundTripMs == null ? null : roundTripMs / 2; lastShown = -1; showDelay(); }
function noteDelay(e){
  if(e && e.timeStamp) touchMs.push(Math.max(0, performance.now() - e.timeStamp));
  if(touchMs.length > 20) touchMs.shift();
  showDelay();
}
export function delayMs(){
  if(!voice) return 0;
  const c = voice.ctx, out = Math.max(((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000, measuredOut || 0), touch = touchMs.length ? touchMs.reduce((x, y) => x + y) / touchMs.length : 0;
  return Math.round(out + touch + 128 / c.sampleRate * 1000);
}
function showDelay(){
  const ms = delayMs(); if(!panel || ms === lastShown) return; lastShown = ms;
  const el = document.querySelector('.synth-lat'); el.textContent = ms + ' ms from your finger to your ears';
  el.classList.toggle('slow', ms > 60);
  el.title = ms > 60 ? 'That much delay is usually Bluetooth headphones. Wired ones make the synth feel instant.' : 'From your finger to your ears';
  panel.querySelector('.synth-warn').hidden = ms <= 60;
}

// Mono, last note wins: let go and it falls back to a note you're still holding.
function down(id, midi, e){ held = held.filter(h => h.id !== id); const legato = held.length > 0; held.push({ id, midi }); sound(midi, legato); light(); noteDelay(e); }
function up(id){ const was = held.length && held[held.length - 1].id === id; held = held.filter(h => h.id !== id); if(!held.length) silence(); else if(was) sound(held[held.length - 1].midi, true); light(); }
function move(id, midi){ const h = held.find(h => h.id === id); if(!h || h.midi === midi) return; h.midi = midi; if(held[held.length - 1] === h) sound(midi, true); light(); }
const light = () => panel && panel.querySelectorAll('[data-midi]').forEach(p => p.classList.toggle('on', held.length > 0 && +p.dataset.midi === held[held.length - 1].midi));

const wide = () => panel && panel.clientWidth >= 640;
function render(force){
  const arr = S.arr || {}, k = [arr.key, arr.style, lowC, wide(), inKeyOnly].join('|');
  if(k === keyShown && !force) return; keyShown = k;
  document.querySelectorAll('[data-scale]').forEach(b => b.setAttribute('aria-checked', String((b.dataset.scale === 'key') === inKeyOnly)));
  shown = keysFor(arr.key, arr.style, lowC, wide() ? 2 : 1, inKeyOnly);
  const row = panel.querySelector('.synth-pads'), letters = inKeyOnly ? SCALE_KEYS : CHROMATIC_KEYS;
  row.innerHTML = ''; row.style.setProperty('--n', shown.length);
  row.classList.toggle('dense', panel.clientWidth / shown.length < 46);   // too narrow for cubes: tall keys instead
  shown.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'key' + (n.sharp ? ' sharp' : '') + (n.inKey ? ' in' : '') + (n.root ? ' root' : ''); el.dataset.midi = n.midi;
    const li = inKeyOnly ? letters[i] : letters[n.midi - lowC];
    el.innerHTML = `<span class="nm">${n.name}</span>` + (li ? `<span class="kb">${li.toUpperCase()}</span>` : '');
    row.appendChild(el);
  });
  light();
}
export function shift(dir){ lowC = Math.max(36, Math.min(84, lowC + 12 * dir)); render(true); }
export function showScaleOnly(on){ inKeyOnly = on; try{ localStorage.setItem('ss.synthScale', on ? 'key' : 'all'); }catch(e){} render(true); }

// Touch/mouse: one pointer per finger; sliding onto another key glides to it.
function wire(){
  const row = panel.querySelector('.synth-pads'), keyAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest && el.closest('[data-midi]'); };
  row.addEventListener('pointerdown', e => { const p = keyAt(e.clientX, e.clientY); if(!p || !voice) return; e.preventDefault(); down('p' + e.pointerId, +p.dataset.midi, e); try{ row.setPointerCapture(e.pointerId); }catch(err){} });
  row.addEventListener('pointermove', e => { if(!voice) return; const p = keyAt(e.clientX, e.clientY); if(p) move('p' + e.pointerId, +p.dataset.midi); });
  ['pointerup', 'pointercancel'].forEach(t => row.addEventListener(t, e => voice && up('p' + e.pointerId)));
  row.addEventListener('contextmenu', e => e.preventDefault());   // a long press is a held note, not a menu
  window.addEventListener('keydown', e => {
    if(!voice || e.repeat || e.metaKey || e.ctrlKey || /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if(k === 'z' || k === 'x'){ shift(k === 'z' ? -1 : 1); return; }
    const midi = inKeyOnly ? (shown[SCALE_KEYS.indexOf(k)] || {}).midi : (CHROMATIC_KEYS.includes(k) ? lowC + CHROMATIC_KEYS.indexOf(k) : null);
    if(midi == null || (inKeyOnly && SCALE_KEYS.indexOf(k) < 0)) return;
    down('k' + k, midi, e); e.preventDefault();
  });
  window.addEventListener('keyup', e => { if(voice) up('k' + e.key.toLowerCase()); });
  panel.querySelectorAll('[data-oct]').forEach(b => b.onclick = () => shift(+b.dataset.oct));
  document.querySelectorAll('[data-scale]').forEach(b => b.onclick = () => showScaleOnly(b.dataset.scale === 'key'));
  window.addEventListener('resize', () => voice && render());
}

let timer = null;
// Volume: what you hear and what the room gets (dB, 0 = as designed).
let level = (() => { try{ const v = localStorage.getItem('ss.synthVol'); return v === null ? 1 : Math.pow(10, +v / 20); }catch(e){ return 1; } })();
export function setVolume(db){ level = db <= -40 ? 0 : Math.pow(10, db / 20); if(voice) voice.out.gain.setTargetAtTime(level, voice.out.context.currentTime, 0.02); }
// Turn it on: `ctx` is the jam's audio context, `toRoom` where your input goes, `toEars` your headphones.
export function start(el, ctx, toRoom, toEars){
  if(voice) return;
  if(!panel){ panel = el; wire(); }
  if(inKeyOnly === null){ let saved = null; try{ saved = localStorage.getItem('ss.synthScale'); }catch(e){} inKeyOnly = saved ? saved === 'key' : matchMedia('(pointer:coarse)').matches || innerWidth < 700; }   // phones: big in-key cubes
  const out = ctx.createGain(); out.gain.value = level; out.connect(toRoom); out.connect(toEars);
  voice = build(ctx, out); voice.out = out; held = []; lastShown = -1;
  panel.hidden = false;
  keyShown = ''; render(); showDelay(); timer = setInterval(() => { render(); showDelay(); }, 1000);   // follows the song's key
}
export function stop(){
  if(!voice) return;
  voice.stopAll(); voice.out.disconnect(); voice = null; held = []; clearInterval(timer);
  if(panel) panel.hidden = true;
}
export const isOn = () => !!voice;
// For tests: play a key by note number.
export const press = midi => voice && down('t', midi), release = () => voice && up('t');
export const outNode = () => voice && voice.out;
