// Music theory, band styles and the built-in prompt interpreter (used when the
// Claude arrangement API isn't available). Pure functions, no audio or DOM.
import { clamp } from '../util.js';

export const NAMES = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
export function pcOf(s){ const b={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[s[0].toUpperCase()]; if(b===undefined) return null; let v=b; if(s[1]==='#') v++; else if(s[1]==='b') v--; return (v+12)%12; }
export const QUAL = {'':[0,4,7],maj:[0,4,7],M:[0,4,7],m:[0,3,7],min:[0,3,7],'-':[0,3,7],'5':[0,7],'6':[0,4,7,9],m6:[0,3,7,9],'7':[0,4,7,10],maj7:[0,4,7,11],M7:[0,4,7,11],m7:[0,3,7,10],min7:[0,3,7,10],'-7':[0,3,7,10],m7b5:[0,3,6,10],dim:[0,3,6],dim7:[0,3,6,9],aug:[0,4,8],sus2:[0,2,7],sus4:[0,5,7],sus:[0,5,7],'7sus4':[0,5,7,10],'9':[0,4,7,10,14],m9:[0,3,7,10,14],maj9:[0,4,7,11,14],add9:[0,4,7,14],'11':[0,4,7,10,14,17],m11:[0,3,7,10,14,17],'13':[0,4,7,10,14,21],mmaj7:[0,3,7,11]};
export function parseChord(name){
  const m=/^\s*([A-Ga-g])([#b]?)([^/\s]*)(?:\/([A-Ga-g][#b]?))?\s*$/.exec(name||''); if(!m) return null;
  const root=pcOf(m[1]+m[2]); let q=m[3]||'', ints=QUAL[q], t=q;
  while(!ints && t.length){ t=t.slice(0,-1); ints=QUAL[t]; }
  return { root, ints: ints||QUAL[''], bass: m[4]?pcOf(m[4]):root };
}
export const STYLES = {
  funk:{label:'Funk',bpm:100,root:4,minor:true,swing:false,bass:'syncopated',keys:'stabs',guitar:'scratch',prog:{maj:[[0,'9',2],[5,'9',2]],min:[[0,'m7',2],[5,'7',2]]},drums:{kick:'X.....x...X.....',snare:'....X..o.o..X..o',hat:'XxxxXxxxXxxxXxxx'}},
  rock:{label:'Rock',bpm:120,root:9,minor:false,swing:false,bass:'root8',keys:'pad',guitar:'power',prog:{maj:[[0,'',1],[10,'',1],[5,'',1],[0,'',1]],min:[[0,'m',1],[8,'',1],[10,'',1],[0,'m',1]]},drums:{kick:'X.......X.X.....',snare:'....X.......X...',hat:'x.x.x.x.x.x.x.x.'}},
  blues:{label:'Blues shuffle',bpm:92,root:9,minor:false,swing:true,bass:'walking',keys:'comp',guitar:'strum',prog:{maj:[[0,'7',4],[5,'7',2],[0,'7',2],[7,'7',1],[5,'7',1],[0,'7',1],[7,'7',1]],min:[[0,'m7',4],[5,'m7',2],[0,'m7',2],[8,'7',1],[7,'7',1],[0,'m7',2]]},drums:{kick:'X.......x.......',snare:'....X.......X...',hat:'x.x.x.x.x.x.x.x.'}},
  lofi:{label:'Lo-fi',bpm:78,root:5,minor:false,swing:true,bass:'sustained',keys:'pad',guitar:'arp',prog:{maj:[[0,'maj7',1],[9,'m7',1],[2,'m7',1],[7,'7',1]],min:[[0,'m9',1],[5,'m7',1],[10,'7',1],[3,'maj7',1]]},drums:{kick:'X......x..x.....',snare:'....X.......X...',hat:'x.x.x.x.x.x.x.x.'}},
  jazz:{label:'Jazz',bpm:130,root:10,minor:false,swing:true,bass:'walking',keys:'comp',guitar:'fourbeat',prog:{maj:[[2,'m7',1],[7,'7',1],[0,'maj7',2]],min:[[2,'m7b5',1],[7,'7',1],[0,'m7',2]]},drums:{kick:'o...o...o...o...',snare:'......o.......o.',ride:'x...x.x.x...x.x.'}},
  pop:{label:'Pop',bpm:110,root:0,minor:false,swing:false,bass:'root8',keys:'pad',guitar:'strum',prog:{maj:[[0,'',1],[7,'',1],[9,'m',1],[5,'',1]],min:[[0,'m',1],[8,'',1],[3,'',1],[10,'',1]]},drums:{kick:'X.......X.x.....',snare:'....X.......X...',hat:'x.x.x.x.x.x.x.x.'}},
  reggae:{label:'Reggae',bpm:76,root:9,minor:true,swing:true,bass:'onedrop',keys:'bubble',guitar:'skank',prog:{maj:[[0,'',2],[5,'',2]],min:[[0,'m',2],[5,'m',2]]},drums:{kick:'........X.......',snare:'........x.......',hat:'x.x.x.x.x.x.x.x.'}},
  hiphop:{label:'Hip hop',bpm:88,root:0,minor:true,swing:true,bass:'sustained',keys:'pad',guitar:'off',prog:{maj:[[0,'maj7',1],[9,'m7',1],[2,'m7',1],[7,'7',1]],min:[[0,'m7',1],[8,'maj7',1],[5,'m7',1],[7,'7',1]]},drums:{kick:'X......x.xX.....',snare:'....X.......X...',hat:'x.x.x.x.x.x.x.x.'}}
};
export const BASS_TYPES=['root8','sustained','syncopated','walking','onedrop','off'], KEYS_TYPES=['pad','stabs','comp','bubble','off'], GTR_TYPES=['power','strum','scratch','skank','arp','fourbeat','off'];
export const DESC={root8:'eighth-note roots',sustained:'long, low notes',syncopated:'a syncopated line',walking:'a walking line',onedrop:'a one-drop line',pad:'pads',stabs:'stabs',comp:'comping',bubble:'the bubble',power:'power chords',strum:'strumming',scratch:'funk scratching',skank:'the skank',arp:'arpeggios',fourbeat:'four to the bar'};
export const STYLE_WORDS=[['reggae',['reggae','dub','ska','one drop']],['hiphop',['hip hop','hip-hop','hiphop','boom bap','rap','trap']],['lofi',['lo-fi','lofi','lo fi','chill','study','rainy']],['jazz',['jazz','bebop','bossa','ii-v','2-5-1']],['blues',['blues','shuffle','12 bar','12-bar']],['funk',['funk','groove','disco','neo soul','soul']],['rock',['rock','punk','grunge','indie','metal']],['pop',['pop']]];

export function localArrangement(prompt){
  const p=prompt.toLowerCase(); let style='pop';
  for(const [s,w] of STYLE_WORDS){ if(w.some(x=>p.includes(x))){ style=s; break; } }
  const S=STYLES[style]; let bpm=S.bpm;
  const b=/(\d{2,3})\s*(bpm|beats)/i.exec(prompt);
  if(b) bpm=clamp(+b[1],50,200); else if(/\bslow\b/.test(p)) bpm=Math.round(S.bpm*.82); else if(/\b(fast|uptempo|up-tempo)\b/.test(p)) bpm=Math.round(S.bpm*1.2);
  let root=S.root, minor=S.minor;
  const k=/\bin\s+([a-gA-G])\s?(#|b|sharp|flat)?(?![a-z])\s*(major|minor|maj|min|m)?\b/.exec(prompt);
  if(k){ const acc=k[2]==='sharp'?'#':k[2]==='flat'?'b':(k[2]||''); if(k[3]||acc||k[1]===k[1].toUpperCase()){ root=pcOf(k[1].toUpperCase()+acc); if(k[3]) minor=/^(minor|min|m)$/i.test(k[3]); } }
  if(/\bminor\b/.test(p)) minor=true; else if(/\bmajor\b/.test(p)) minor=false;
  const key=NAMES[root]+(minor?' minor':' major');
  return { title:S.label+' in '+key, style, bpm, key, swing:S.swing,
    chords:(minor?S.prog.min:S.prog.maj).map(([o,q,bars])=>({name:NAMES[(root+o)%12]+q,bars})),
    bass:S.bass, keys:S.keys, guitar:S.guitar, notes:'' };
}
export function finalize(a, source){
  const style=STYLES[a&&a.style]?a.style:'pop', S=STYLES[style];
  const chords=(Array.isArray(a&&a.chords)?a.chords:[]).map(c=>({name:String((c&&c.name)||'').trim(),bars:[1,2,4].includes(+(c&&c.bars))?+c.bars:1})).map(c=>({...c,parsed:parseChord(c.name)})).filter(c=>c.parsed);
  if(!chords.length) throw new Error('no chords');
  let total=0; const kept=[]; for(const c of chords){ if(total+c.bars>32) break; kept.push(c); total+=c.bars; }
  const barMap=[]; kept.forEach((c,i)=>{ for(let n=0;n<c.bars;n++) barMap.push(i); });
  return { title:String(a.title||'Untitled jam').slice(0,60), style, bpm:clamp(Math.round(+a.bpm||S.bpm),50,200), key:String(a.key||'').slice(0,24), swing:!!a.swing,
    chords:kept, barMap, bass:BASS_TYPES.includes(a.bass)?a.bass:S.bass, keys:KEYS_TYPES.includes(a.keys)?a.keys:S.keys, guitar:GTR_TYPES.includes(a.guitar)?a.guitar:S.guitar,
    notes:String(a.notes||'').slice(0,220), source };
}
