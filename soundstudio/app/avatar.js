// Characters: a little pixel player instead of your camera. You pick one of
// four on the start screen (or keep your camera); it bobs on the beat and switches to its "playing" frame
// when you play, timed to when the others actually hear you (so in Trade bars
// it moves with your delayed audio, not ahead of it).
import { S, me } from './state.js';
import * as room from './net/room.js';
import { tiles, placeSpots } from './ui.js';
import { muted } from './presence.js';

const looks = new Map();   // id -> { on, char } for each player
let mine = false, myChar = 0, myMuted = false, lastBeat = 0;
export const isOn = () => mine;
export const beat = () => { lastBeat = performance.now(); };

// Turn yours on/off (and pick your player) and tell the room. Returns the new state.
const look = () => ({ t:'look', avatar:mine, char:myChar, muted:myMuted });
export function setMine(on, char = myChar){ mine = on; myChar = char; looks.set(me.id, { on, char }); room.send(look()); return on; }
// Your mic muted (you show greyed out for everyone).
export function setMuted(on){ myMuted = on; if(on) muted.add(me.id); else muted.delete(me.id); room.send(look()); placeSpots(); }
export const tellNewcomer = id => { if(mine || myMuted) room.send(look(), id); };
export function handle(m, id){
  if(m.t !== 'look') return false;
  looks.set(id, { on:!!m.avatar, char:m.char });
  if(m.muted) muted.add(id); else muted.delete(id);
  placeSpots(); return true;
}

// The characters, Pokemon-overworld style: a chibi facing you (16 x 16) inside a
// 20 x 20 grid with its instrument. H hair, S skin, E eyes, M mouth, T shirt,
// D shirt shade, P trousers, B shoes.
const BODY = [
  '....HHHHHHHH....', '...HHHHHHHHHH...', '..HHHHHHHHHHHH..', '..HHSSSSSSSSHH..', '..HSSESSSSESSH..', '..HSSESSSSESSH..',
  '...SSSSSSSSSS...', '....SSSMMSSS....', '.....SSSSSS.....', '...TTTTTTTTTT...', '..TTTTTTTTTTTT..', '..STTDTTTTDTTS..',
  '..STTTTTTTTTTS..', '...PPPPPPPPPP...', '...PPPP..PPPP...', '...BBBB..BBBB...',
];

// The four players: each has their own hair, colours and Strat finish.
// hair: rows that replace the top of BODY (C = beanie, c = its band).
export const CHARS = [
  { name:'Blaze', H:'#d8322a', S:'#f6d2b8', T:'#34322d', P:'#3b3b3b', R:'#d7262f', hair:{ 0:'...H..HH..H..H..', 1:'...HHHHHHHHHHH..' } },
  { name:'Juno', H:'#7b4fd6', S:'#c68a62', T:'#29a19c', P:'#2d3a4a', R:'#2a9d8f', hair:{
    3:'.HHHSSSSSSSSHHH.', 4:'.HHSSESSSSESSHH.', 5:'.HHSSESSSSESSHH.', 6:'.HHSSSSSSSSSSHH.', 7:'.HH.SSSMMSSS.HH.', 8:'.HH..SSSSSS..HH.' } },
  { name:'Dex', H:'#2b1d16', S:'#8d5a3b', T:'#f0a238', P:'#2d3a4a', R:'#e07b1f', hair:{
    0:'...HHHHHHHHHH...', 1:'.HHHHHHHHHHHHHH.', 2:'HHHHHHHHHHHHHHHH', 3:'.HHHSSSSSSSSHHH.', 4:'.HHSSESSSSESSHH.' } },
  { name:'Moss', H:'#d8a444', S:'#e8b48f', T:'#0984e3', P:'#4a3b2a', R:'#e8e4d8', C:'#2f8f4e', c:'#236b3a', hair:{
    0:'.......CC.......', 1:'....CCCCCCCC....', 2:'..CCCCCCCCCCCC..', 3:'..cccccccccccc..' } },
];
export const charOf = v => Number.isInteger(v) && v >= 0 && v < CHARS.length ? v : 0;
// Each part has its pad colour (like a lit pad), and the AI band its own players.
export { PAD } from './avatar-colors.js';
export const AI_CHAR = { drums:3, bass:1, keys:0, guitar:2 };

// The character with its instrument: a Strat (or a longer-necked bass) across the
// body, a keyboard in front, or a drum kit seen from above. Rows of colour keys.
function compose(inst, playing, hair = {}, ai = false){
  const g = Array.from({ length:20 }, () => Array(20).fill('.'));
  const put = (x, y, c) => { if(x >= 0 && x < 20 && y >= 0 && y < 20) g[y][x] = c; };
  const disc = (cx, cy, r2, in2, rim, head) => { for(let y = cy - 4; y <= cy + 4; y++) for(let x = cx - 4; x <= cx + 4; x++){ const d = (x - cx) ** 2 + (y - cy) ** 2; if(d <= r2) put(x, y, d > in2 ? rim : head); } };
  const sitting = inst === 'drums' || inst === 'keys', yo = sitting ? 1 : 3;
  BODY.forEach((r, y) => [...(hair[y] || r)].forEach((c, x) => { if(c !== '.') put(x + 2, y + yo, c); }));
  if(ai){ for(let x = 5; x <= 14; x++){ put(x, 4 + yo, 'V'); put(x, 5 + yo, 'V'); } put(7, 4 + yo, 'v'); put(12, 4 + yo, 'v'); }   // the AI players wear a visor
  if(playing){ put(9, 7 + yo, 'M'); put(10, 7 + yo, 'M'); put(9, 8 + yo, 'M'); put(10, 8 + yo, 'M'); }   // singing along
  if(inst === 'guitar' || inst === 'bass'){
    const bass = inst === 'bass';
    [[9,14],[10,14],[11,13],[12,13],[13,12],[14,12],[15,11],[16,11], ...(bass ? [[17,10],[18,10]] : [])].forEach(([x, y]) => put(x, y, 'n'));
    (bass ? [[19,9],[19,8]] : [[17,10],[18,10],[18,9]]).forEach(([x, y]) => put(x, y, 'p'));
    const body = bass ? { 13:[3,6], 14:[2,8], 15:[1,8], 16:[1,7], 17:[2,6] } : { 13:[4,6], 14:[3,8], 15:[2,8], 16:[2,7], 17:[3,6] };
    for(const [y, [a, b]] of Object.entries(body)) for(let x = a; x <= b; x++) put(x, +y, 'R');
    (bass ? [[4,15],[5,15]] : [[5,14],[4,15],[5,15],[6,15],[4,16],[5,16]]).forEach(([x, y]) => put(x, y, 'w'));
    put(8, playing ? 16 : 15, 'S'); put(bass ? 16 : 14, bass ? 10 : 11, 'S');   // strumming hand, fretting hand
  } else if(inst === 'drums'){
    disc(2, 10, 3, 9, 'Y', 'Y'); put(2, 10, 'k'); disc(17, 10, 3, 9, 'Y', 'Y'); put(17, 10, 'k');
    disc(7, 11, 2, 0.5, 'R', 'w'); disc(12, 11, 2, 0.5, 'R', 'w'); disc(10, 16, 9, 5, 'R', 'w');
    disc(5, 14, 2, 0.5, 'p', 'w'); disc(15, 14, 3, 1, 'R', 'w');
    const up = playing ? 1 : 0; put(6, 9 - up, 'S'); put(13, 9 - up, 'S'); put(5, 8 - up, 'n'); put(14, 8 - up, 'n');
  } else if(inst === 'keys'){
    const blacks = 'WXWXWWXWXWXWWXWXWW';
    for(let x = 1; x <= 18; x++){ put(x, 12, 'k'); put(x, 13, blacks[x - 1]); put(x, 14, 'W'); put(x, 15, 'k'); }
    const hop = playing ? 1 : 0; put(6 + hop, 12, 'S'); put(7 + hop, 12, 'S'); put(12 - hop, 12, 'S'); put(13 - hop, 12, 'S');
    [[2,16],[2,17],[17,16],[17,17]].forEach(([x, y]) => put(x, y, 'G'));
  }
  return g;
}

const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0')).join('');
const hash = s => { let h = 2166136261; for(const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function palette(i){
  const c = CHARS[charOf(i)];
  return { H: c.H, S: c.S, E: '#1b1b1b', M: '#a33a3a', T: c.T, D: shade(c.T, 0.72), P: c.P, B: '#1b1b1b', C: c.C, c: c.c,
    R: c.R, k: '#1d1c1a', w: '#f4f1ea', n: '#e2b46a', p: '#c9ced6', W: '#f4f1ea', X: '#26241f', Y: '#e8c14d', G: '#5a5650', V: '#15161a', v: '#8fe8ff', bg: c.T };
}
export const seatOf = name => { const s = S.seats.find(x => x.human && x.who === name); return s ? s.id : null; };
export const charFor = (id, name) => { const l = looks.get(id); return l && Number.isInteger(l.char) ? charOf(l.char) : hash(name) % CHARS.length; };

// Draws a character on a transparent canvas, one sprite pixel = canvas.width / 20.
export function draw(canvas, char, inst, playing, bob, ai = false){
  const key = [char, inst, playing, bob, ai].join('|');
  if(canvas.dataset.k === key) return;   // same frame as last time: nothing to paint (keeps the page light while you play)
  canvas.dataset.k = key;
  const g = canvas.getContext('2d'), px = Math.floor(canvas.width / 20), c = palette(char), y0 = bob ? -1 : 0;
  g.clearRect(0, 0, canvas.width, canvas.height);
  compose(inst, playing, CHARS[charOf(char)].hair, ai).forEach((row, y) => row.forEach((k, x) => { if(k !== '.' && c[k]){ g.fillStyle = c[k]; g.fillRect(x * px, (y + y0) * px, px, px); } }));
}
const sprite = holder => {
  let cv = holder.querySelector('canvas.sprite');
  if(!cv){ cv = document.createElement('canvas'); cv.className = 'sprite'; cv.width = cv.height = 100; holder.prepend(cv); }
  return cv;
};

// ~12 frames a second: every player shown as a character (anyone without a
// camera picture, or who chose a character) and the AI band's players.
setInterval(() => {
  const beatNow = performance.now() - lastBeat < 120;
  tiles.forEach((t, id) => {
    const l = looks.get(id), on = !!(l && l.on) || !t.querySelector('video'); t.classList.toggle('avatar', on); if(!on) return;
    const name = id === me.id ? me.name : ((room.peers.get(id) || {}).name || '');
    draw(sprite(t), charFor(id, name), seatOf(name) || 'guitar', room.levelNow(id === me.id ? 'me' : id) > 0.06, beatNow);
  });
  document.querySelectorAll('.spot.ai').forEach(sp => {
    const seat = sp.dataset.seat, out = sp.classList.contains('off');
    const on = S.playing && !out && !sp.classList.contains('muted') && beatNow;
    draw(sprite(sp.querySelector('.fig')), AI_CHAR[seat] ?? 0, seat, on, on, true);
  });
}, 80);

// ---- the start screen: pick your player, arcade style ----
// A tight 24 x 24 portrait (one canvas pixel per sprite pixel; CSS scales it up crisply).
export function portrait(canvas, char, playing, bob){
  const g = canvas.getContext('2d'), c = palette(char);
  canvas.width = canvas.height = 24;
  g.fillStyle = '#1c1d20'; g.fillRect(0, 0, 24, 24);
  g.fillStyle = shade(c.bg, 0.45); g.fillRect(4, 20, 16, 2);   // their spot on the floor
  compose('guitar', playing, CHARS[charOf(char)].hair).forEach((row, y) => row.forEach((k, x) => { if(k !== '.' && c[k]){ g.fillStyle = c[k]; g.fillRect(2 + x, 2 + y - (bob ? 1 : 0), 1, 1); } }));
}
// The "keep my camera" choice: a little pixel camera.
const CAM = ['....kkkk........', '..kkkkkkkkkkk.kk', '..kwwkkkkkkkkkrk', '..kkkkgggkkkkkkk', '..kkkgbbbgkkkkkk', '..kkkgbwbgkkkkkk', '..kkkgbbbgkkkkkk', '..kkkkgggkkkkkkk', '..kkkkkkkkkkkkkk'];
export function cameraIcon(canvas, on){
  const g = canvas.getContext('2d'), col = { k:'#3a3b40', w:'#f4f4f2', g:'#8b8c91', b:'#10151b', r: on ? '#e8321c' : '#5d5e63' };
  canvas.width = canvas.height = 24;
  g.fillStyle = '#1c1d20'; g.fillRect(0, 0, 24, 24);
  CAM.forEach((row, y) => [...row].forEach((k, x) => { if(k !== '.'){ g.fillStyle = col[k]; g.fillRect(3 + x, 7 + y, 1, 1); } }));
}
