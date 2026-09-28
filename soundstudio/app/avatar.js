// Avatars: a little pixel character instead of your camera. You pick one of
// four players on the start screen (or keep your camera); it bobs on the beat and switches to its "playing" frame
// when you play, timed to when the others actually hear you (so in Trade bars
// it moves with your delayed audio, not ahead of it).
import { S, me } from './state.js';
import * as room from './net/room.js';
import { tiles } from './ui.js';

const looks = new Map();   // id -> { on, char } for each player
let mine = false, myChar = 0, lastBeat = 0;
export const isOn = () => mine;
export const beat = () => { lastBeat = performance.now(); };

// Turn yours on/off (and pick your player) and tell the room. Returns the new state.
const look = () => ({ t:'look', avatar:mine, char:myChar });
export function setMine(on, char = myChar){ mine = on; myChar = char; looks.set(me.id, { on, char }); room.send(look()); return on; }
export const tellNewcomer = id => { if(mine) room.send(look(), id); };
export function handle(m, id){ if(m.t !== 'look') return false; looks.set(id, { on:!!m.avatar, char:m.char }); return true; }

// 20 x 20 pixel character. H hair, S skin, E eyes, M mouth, T shirt, D shirt shade, P trousers, B shoes.
const BODY = [
  '........HHHH........', '......HHHHHHHH......', '.....HHHHHHHHHH.....', '.....HSSSSSSSSH.....', '.....HSESSSSESH.....',
  '......SSSSSSSS......', '......SSSMMSSS......', '.......SSSSSS.......', '.....TTTTTTTTTT.....', '....TTTTTTTTTTTT....',
  '....TTDTTTTTTDTT....', '....TTTTTTTTTTTT....', '....TTTTTTTTTTTT....', '.....TTTTTTTTTT.....', '......PPPPPPPP......',
  '......PPPPPPPP......', '......PPP..PPP......', '......PPP..PPP......', '......PPP..PPP......', '.....BBBB..BBBB.....',
];

// The four players: each has their own hair, colours and Strat finish.
// hair: rows that replace the top of BODY (C = beanie, c = its band).
export const CHARS = [
  { name:'Blaze', H:'#d8322a', S:'#f6d2b8', T:'#1d1c1a', P:'#3b3b3b', R:'#d7262f', hair:{
    0:'....H..H..H..H......', 1:'....HHHHHHHHHHH.....', 2:'.....HHHHHHHHHH.....' } },
  { name:'Juno', H:'#7b4fd6', S:'#c68a62', T:'#29a19c', P:'#2d3a4a', R:'#2a9d8f', hair:{
    3:'....HHSSSSSSSSHH....', 4:'....HHSESSSSESHH....', 5:'....HHSSSSSSSSHH....', 6:'....HHSSSMMSSSHH....', 7:'....HH.SSSSSS.HH....' } },
  { name:'Dex', H:'#2b1d16', S:'#8d5a3b', T:'#f0a238', P:'#2d3a4a', R:'#f0a238', hair:{
    0:'......HHHHHHHH......', 1:'....HHHHHHHHHHHH....', 2:'...HHHHHHHHHHHHHH...', 3:'...HHHSSSSSSSSHHH...', 4:'....HHSESSSSESHH....' } },
  { name:'Moss', H:'#d8a444', S:'#e8b48f', T:'#0984e3', P:'#4a3b2a', R:'#e8e4d8', C:'#2f8f4e', c:'#236b3a', hair:{
    0:'.........CC.........', 1:'......CCCCCCCC......', 2:'.....CCCCCCCCCC.....', 3:'.....cccccccccc.....' } },
];
export const charOf = v => Number.isInteger(v) && v >= 0 && v < CHARS.length ? v : 0;

// The character with its instrument: a Strat held on the diagonal (body on the
// hip, neck past the shoulder), a keyboard, or drums. Returns rows of colour keys.
function compose(inst, playing, hair = {}){
  const g = BODY.map((r, y) => [...(hair[y] || r)]);
  const put = (x, y, c) => { if(x >= 0 && x < 20 && y >= 0 && y < 20) g[y][x] = c; };
  if(playing){ put(8, 6, 'M'); put(11, 6, 'M'); }   // singing along
  if(inst === 'keys'){
    for(let x = 1; x < 19; x++){ put(x, 13, x % 3 === 1 ? 'X' : 'W'); put(x, 14, 'W'); put(x, 15, 'k'); }
    put(1, 16, 'k'); put(18, 16, 'k'); put(1, 17, 'k'); put(18, 17, 'k');
    put(playing ? 6 : 7, playing ? 13 : 12, 'S'); put(playing ? 13 : 12, playing ? 12 : 13, 'S');
  } else if(inst === 'drums'){
    const drum = { 14: [3, 'kRRRRRRRRRRRRk'], 15: [3, 'kRwwwwwwwwwwRk'], 16: [3, 'kRRRRRRRRRRRRk'], 17: [4, 'k..........k'], 18: [4, 'k..........k'] };
    for(const [y, [x0, row]] of Object.entries(drum)) [...row].forEach((c, i) => { if(c !== '.') put(x0 + i, +y, c); });
    const up = playing ? -2 : 0;
    for(let i = 0; i < 3; i++){ put(4, 11 + up + i, 'n'); put(15, 11 - up + i, 'n'); }
  } else {
    // neck: maple, rising one row every two columns, outlined, fret dots
    for(let x = 9; x <= 17; x++){ const yc = 12 - Math.floor((x - 9) / 2); put(x, yc - 2, 'k'); put(x, yc - 1, 'n'); put(x, yc, 'n'); put(x, yc + 1, 'k'); if(x % 2 === 0 && x > 10) put(x, yc, 'f'); }
    [[18,5,'p'],[19,5,'p'],[18,6,'h'],[19,6,'h'],[18,7,'h'],[19,7,'k'],[18,8,'k']].forEach(([x, y, c]) => put(x, y, c));
    const body = { 10: [5, 'kk'], 11: [4, 'kRRk'], 12: [2, 'kkRRRRk'], 13: [1, 'kRRwwwRRkk'], 14: [0, 'kRRwwwwwRRk'], 15: [0, 'kRwwwwwwwRk'], 16: [0, 'kRRwwwwRRk'], 17: [1, 'kRRRRRRk'], 18: [2, 'kkkkkk'] };
    for(const [y, [x0, row]] of Object.entries(body)) [...row].forEach((c, i) => { if(c !== '.') put(x0 + i, +y, c); });
    [[6,13],[7,14],[4,14],[5,15],[2,15],[3,16]].forEach(([x, y]) => put(x, y, 'K'));   // three slanted pickups, then the bridge
    put(1, 15, 'p'); put(1, 16, 'p');
    put(15, 8, 'S'); put(15, 9, 'S'); put(16, 9, 'S');   // fretting hand
    if(playing){ put(8, 16, 'S'); put(9, 16, 'S'); } else { put(8, 14, 'S'); put(9, 15, 'S'); }   // strumming hand
  }
  return g;
}

const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0')).join('');
const hash = s => { let h = 2166136261; for(const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function palette(i){
  const c = CHARS[charOf(i)];
  return { H: c.H, S: c.S, E: '#1b1b1b', M: '#a33a3a', T: c.T, D: shade(c.T, 0.75), P: c.P, B: '#1b1b1b', C: c.C, c: c.c,
    R: c.R, k: '#1d1c1a', w: '#f4f1ea', K: '#1d1c1a', n: '#e2b46a', f: '#7a4b22', h: '#e2b46a', p: '#c9ced6', W: '#f4f1ea', X: '#1b1b1b', bg: c.T === '#1d1c1a' ? c.R : c.T };
}
const instrumentOf = name => { const s = S.seats.find(x => x.human && x.who === name); return s ? s.id : 'guitar'; };

// Draws player `char` into the canvas (a stage backdrop in their colour), holding `inst`.
export function draw(canvas, char, inst, playing, bob){
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, px = Math.floor(Math.min(W / 32, (H - 40) / 20)), c = palette(char);
  // a faceplate-style backdrop: the player's colour, softly, on the stage floor
  g.fillStyle = shade(c.bg, 0.22); g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, W * 0.6); glow.addColorStop(0, shade(c.bg, 0.5)); glow.addColorStop(1, shade(c.bg, 0.22));
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, H - 30, W, 30);
  const x0 = Math.round((W - 20 * px) / 2), y0 = H - 20 * px - Math.round(H / 15) - (playing ? 3 : 0) - (bob ? 2 : 0);
  compose(inst, playing, CHARS[charOf(char)].hair).forEach((row, y) => row.forEach((k, x) => { if(k !== '.'){ g.fillStyle = c[k]; g.fillRect(x0 + x * px, y0 + y * px, px, px); } }));
}

// ~12 frames a second: every tile showing an avatar.
setInterval(() => {
  const beatNow = performance.now() - lastBeat < 120;
  tiles.forEach((t, id) => {
    const l = looks.get(id), on = !!(l && l.on); t.classList.toggle('avatar', on); if(!on) return;
    let cv = t.querySelector('canvas.sprite');
    if(!cv){ cv = document.createElement('canvas'); cv.className = 'sprite'; cv.width = 320; cv.height = 240; t.insertBefore(cv, t.querySelector('.tname')); }
    const name = id === me.id ? me.name : ((room.peers.get(id) || {}).name || '');
    draw(cv, l.char ?? hash(name) % CHARS.length, instrumentOf(name), room.levelNow(id === me.id ? 'me' : id) > 0.06, beatNow);
  });
}, 80);

// ---- the start screen: pick your player, arcade style ----
// A tight 24 x 24 portrait (one canvas pixel per sprite pixel; CSS scales it up crisply).
export function portrait(canvas, char, playing, bob){
  const g = canvas.getContext('2d'), c = palette(char);
  canvas.width = canvas.height = 24;
  g.fillStyle = shade(c.bg, 0.3); g.fillRect(0, 0, 24, 24);
  g.fillStyle = shade(c.bg, 0.45); g.fillRect(0, 21, 24, 3);
  compose('guitar', playing, CHARS[charOf(char)].hair).forEach((row, y) => row.forEach((k, x) => { if(k !== '.'){ g.fillStyle = c[k]; g.fillRect(2 + x, 3 + y - (bob ? 1 : 0) - (playing ? 1 : 0), 1, 1); } }));
}
// The "keep my camera" choice: a little pixel camera.
const CAM = ['....kkkk........', '..kkkkkkkkkkk.kk', '..kwwkkkkkkkkkrk', '..kkkkgggkkkkkkk', '..kkkgbbbgkkkkkk', '..kkkgbwbgkkkkkk', '..kkkgbbbgkkkkkk', '..kkkkgggkkkkkkk', '..kkkkkkkkkkkkkk'];
export function cameraIcon(canvas, on){
  const g = canvas.getContext('2d'), col = { k:'#3a3833', w:'#f4f1ea', g:'#8f8a80', b:'#1b2a3a', r: on ? '#d6452a' : '#5a5650' };
  canvas.width = canvas.height = 24;
  g.fillStyle = '#26251f'; g.fillRect(0, 0, 24, 24); g.fillStyle = '#34322d'; g.fillRect(0, 21, 24, 3);
  CAM.forEach((row, y) => [...row].forEach((k, x) => { if(k !== '.'){ g.fillStyle = col[k]; g.fillRect(3 + x, 7 + y, 1, 1); } }));
}
