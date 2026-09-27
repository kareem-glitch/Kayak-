// Avatars: a little pixel character instead of your camera. Its look comes
// from your name; it bobs on the beat and switches to its "playing" frame
// when you play, timed to when the others actually hear you (so in Trade bars
// it moves with your delayed audio, not ahead of it).
import { S, me } from './state.js';
import * as room from './net/room.js';
import { tiles } from './ui.js';

const looks = new Map();   // id -> true when that player shows an avatar
let mine = false, lastBeat = 0;
export const isOn = () => mine;
export const beat = () => { lastBeat = performance.now(); };

// Turn yours on/off and tell the room. Returns the new state.
export function setMine(on){ mine = on; looks.set(me.id, on); room.send({ t:'look', avatar:on }); return on; }
export const tellNewcomer = id => { if(mine) room.send({ t:'look', avatar:true }, id); };
export function handle(m, id){ if(m.t !== 'look') return false; looks.set(id, !!m.avatar); return true; }

// 16 x 17 pixel character. H hair, S skin, E eyes, M mouth, T shirt, D shirt shade, P trousers, B shoes.
const BODY = [
  '......HHHH......', '....HHHHHHHH....', '...HHHHHHHHHH...', '...HSSSSSSSSH...', '...HSESSSSESH...',
  '....SSSSSSSS....', '....SSSMMSSS....', '.....SSSSSS.....', '...TTTTTTTTTT...', '..TTTTTTTTTTTT..',
  '..TTDTTTTTTDTT..', '..SSTTTTTTTTSS..', '....TTTTTTTT....', '....PPPPPPPP....', '....PPP..PPP....',
  '....PPP..PPP....', '...BBBB..BBBB...',
];
const OPEN_MOUTH = '....SSMMMMSS....';
// Instruments drawn over the body (G body, K dark, N neck / sticks, W white keys, X black keys, R drum).
const GUITAR = { 8:'.............NN.', 9:'............NN..', 10:'..GGG......NN...', 11:'.GGGGGNNNNNN....', 12:'.GGKGG..........', 13:'.GGGGG..........', 14:'..GGG...........' };
const KEYS = { 12:'.XWXWWXWXWXWWXW.', 13:'.WWWWWWWWWWWWWW.', 14:'.KKKKKKKKKKKKKK.' };
const DRUMS = { 13:'...RRRRRRRRRR...', 14:'...RKKKKKKKKR...', 15:'...RRRRRRRRRR...' };

const SKIN = ['#f6d2b8', '#e8b48f', '#c68a62', '#8d5a3b', '#5c3a24'];
const HAIR = ['#2b1d16', '#5a3825', '#d8a444', '#b84a2e', '#e7e3da', '#4a6cd4', '#d84a9b'];
const SHIRT = ['#e4572e', '#29a19c', '#f0a238', '#6c5ce7', '#2d3436', '#00b894', '#e84393', '#0984e3'];
const PANTS = ['#2d3a4a', '#3b3b3b', '#4a3b2a'];
const WOOD = ['#c0392b', '#e67e22', '#8e5a2b', '#2c3e50'];
const hash = s => { let h = 2166136261; for(const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0')).join('');

function palette(name){
  const h = hash(name), pick = (a, n) => a[(h >>> n) % a.length], shirt = pick(SHIRT, 3);
  return { H: pick(HAIR, 6), S: pick(SKIN, 0), E: '#1b1b1b', M: '#a33a3a', T: shirt, D: shade(shirt, 0.75), P: pick(PANTS, 9), B: '#1b1b1b',
    G: pick(WOOD, 12), K: '#2b1b10', N: '#6b4a2b', W: '#f4f1ea', X: '#1b1b1b', R: shade(shirt, 1.25), bg: shirt };
}
const instrumentOf = name => { const s = S.seats.find(x => x.human && x.who === name); return s ? s.id : 'guitar'; };

function draw(canvas, name, playing, bob){
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, c = palette(name), px = 11;
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, shade(c.bg, 0.35)); grad.addColorStop(1, shade(c.bg, 0.18));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, H - 34, W, 34);   // the stage
  const x0 = Math.round((W - 16 * px) / 2), y0 = H - 17 * px - 22 - (playing ? px : 0) - (bob ? 2 : 0);
  const paint = (rows, from = 0) => rows.forEach((row, i) => { if(!row) return; for(let x = 0; x < 16; x++){ const k = row[x]; if(k !== '.'){ g.fillStyle = c[k]; g.fillRect(x0 + x * px, y0 + (from + i) * px, px, px); } } });
  const body = BODY.slice(); if(playing) body[6] = OPEN_MOUTH;
  paint(body);
  const inst = instrumentOf(name), over = inst === 'keys' ? KEYS : inst === 'drums' ? DRUMS : GUITAR;
  const rows = []; for(const [y, row] of Object.entries(over)) rows[+y] = row; paint(rows);
  g.fillStyle = c.S;   // the playing hand: strumming, hitting, pressing
  if(inst === 'drums'){ g.fillStyle = c.N; const up = playing ? -3 : 0; g.fillRect(x0 + 3 * px, y0 + (10 + up) * px, px, 3 * px); g.fillRect(x0 + 12 * px, y0 + (10 - up) * px, px, 3 * px); }
  else g.fillRect(x0 + (inst === 'keys' ? 7 : 5) * px, y0 + (playing ? 10 : 12) * px, px, px);
}

// ~12 frames a second: every tile showing an avatar.
setInterval(() => {
  const beatNow = performance.now() - lastBeat < 120;
  tiles.forEach((t, id) => {
    const on = !!looks.get(id); t.classList.toggle('avatar', on); if(!on) return;
    let cv = t.querySelector('canvas.sprite');
    if(!cv){ cv = document.createElement('canvas'); cv.className = 'sprite'; cv.width = 320; cv.height = 240; t.insertBefore(cv, t.querySelector('.tname')); }
    const name = id === me.id ? me.name : ((room.peers.get(id) || {}).name || '');
    draw(cv, name, room.levelNow(id === me.id ? 'me' : id) > 0.06, beatNow);
  });
}, 80);
