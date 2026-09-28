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

// 20 x 20 pixel character. H hair, S skin, E eyes, M mouth, T shirt, D shirt shade, P trousers, B shoes.
const BODY = [
  '........HHHH........', '......HHHHHHHH......', '.....HHHHHHHHHH.....', '.....HSSSSSSSSH.....', '.....HSESSSSESH.....',
  '......SSSSSSSS......', '......SSSMMSSS......', '.......SSSSSS.......', '.....TTTTTTTTTT.....', '....TTTTTTTTTTTT....',
  '....TTDTTTTTTDTT....', '....TTTTTTTTTTTT....', '....TTTTTTTTTTTT....', '.....TTTTTTTTTT.....', '......PPPPPPPP......',
  '......PPPPPPPP......', '......PPP..PPP......', '......PPP..PPP......', '......PPP..PPP......', '.....BBBB..BBBB.....',
];
const OPEN_MOUTH = '......SSMMMMSS......';

// The character with its instrument: a Strat held on the diagonal (body on the
// hip, neck past the shoulder), a keyboard, or drums. Returns rows of colour keys.
function compose(inst, playing){
  const g = BODY.map((r, y) => [...(y === 6 && playing ? OPEN_MOUTH : r)]);
  const put = (x, y, c) => { if(x >= 0 && x < 20 && y >= 0 && y < 20) g[y][x] = c; };
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

const SKIN = ['#f6d2b8', '#e8b48f', '#c68a62', '#8d5a3b', '#5c3a24'];
const HAIR = ['#2b1d16', '#5a3825', '#d8a444', '#b84a2e', '#e7e3da', '#4a6cd4', '#d84a9b'];
const SHIRT = ['#e4572e', '#29a19c', '#f0a238', '#6c5ce7', '#2d3436', '#00b894', '#e84393', '#0984e3'];
const PANTS = ['#2d3a4a', '#3b3b3b', '#4a3b2a'];
const FINISH = ['#d7262f', '#2f6fdb', '#1d1c1a', '#e8e4d8', '#f0a238', '#2a9d8f'];   // Strat colours: red, blue, black, olympic white, sunburst, seafoam
const hash = s => { let h = 2166136261; for(const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0')).join('');

function palette(name){
  const h = hash(name), pick = (a, n) => a[(h >>> n) % a.length], shirt = pick(SHIRT, 3);
  return { H: pick(HAIR, 6), S: pick(SKIN, 0), E: '#1b1b1b', M: '#a33a3a', T: shirt, D: shade(shirt, 0.75), P: pick(PANTS, 9), B: '#1b1b1b',
    R: pick(FINISH, 12), k: '#1d1c1a', w: '#f4f1ea', K: '#1d1c1a', n: '#e2b46a', f: '#7a4b22', h: '#e2b46a', p: '#c9ced6', W: '#f4f1ea', X: '#1b1b1b', bg: shirt };
}
const instrumentOf = name => { const s = S.seats.find(x => x.human && x.who === name); return s ? s.id : 'guitar'; };

function draw(canvas, name, playing, bob){
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, c = palette(name), px = 10;
  // a faceplate-style backdrop: the player's colour, softly, on the stage floor
  g.fillStyle = shade(c.bg, 0.22); g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, W * 0.6); glow.addColorStop(0, shade(c.bg, 0.5)); glow.addColorStop(1, shade(c.bg, 0.22));
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, H - 30, W, 30);
  const x0 = Math.round((W - 20 * px) / 2), y0 = H - 20 * px - 16 - (playing ? 3 : 0) - (bob ? 2 : 0);
  compose(instrumentOf(name), playing).forEach((row, y) => row.forEach((k, x) => { if(k !== '.'){ g.fillStyle = c[k]; g.fillRect(x0 + x * px, y0 + y * px, px, px); } }));
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
