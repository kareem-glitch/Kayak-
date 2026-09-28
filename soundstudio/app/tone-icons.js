// 16x16 pixel-art amps for the tone picker, arcade style. Each sprite has two
// frames: the pilot light (L) on, then off, for a blink when selected.
const BASE = { k: '#17161b', w: '#efe6d2', W: '#c9bc9f', s: '#c9ced6', S: '#8e96a3', g: '#8a8f98', G: '#4c515a', b: '#26252b', B: '#3a3942', y: '#f2c14e' };

export const SPRITES = {
  off: { name: 'DI box', pal: { L: '#4cd964' }, rows: [
    '................', '................', '................', '..kkkkkkkkkkkk..',
    '..kggggggggggk..', '..kgkkggggkkgk..', '..kgkkggggkkgk..', '..kggggLgggggk..',
    '..kGGGGGGGGGGk..', '..kkkkkkkkkkkk..', '....k......k....', '....k......k....',
    '.....k......k...', '......kk.....k..', '........k.....k.', '................',
  ] },
  clean: { name: 'Black combo, silver grille', pal: { L: '#4da3ff' }, rows: [
    '................', '.....kkkkkk.....', '.....k....k.....', '.kkkkkkkkkkkkkk.',
    '.kbbbbbbbbbbbbk.', '.kbsssssssssbbk.', '.kbskskskskLsbk.', '.kbsssssssssbbk.',
    '.kbbbbbbbbbbbbk.', '.kbGSGSGSGSGSbk.', '.kbSGSGSGSGSGbk.', '.kbGSGSGSGSGSbk.',
    '.kbSGSGSGSGSGbk.', '.kbGSGSGSGSGSbk.', '.kBBBBBBBBBBBBk.', '.kkkkkkkkkkkkkk.',
  ] },
  warm: { name: 'Tweed combo', pal: { t: '#dcbc7f', T: '#b48f55', n: '#6b4a2b', N: '#4a321d', L: '#ff5a3c' }, rows: [
    '................', '.....kkkkkk.....', '.....k....k.....', '.kkkkkkkkkkkkkk.',
    '.ktTttTttTttTtk.', '.kTssssssssssTk.', '.ktskskskskLstk.', '.kTssssssssssTk.',
    '.ktTttTttTttTtk.', '.kTnNnNnNnNnNTk.', '.ktNnNnNnNnNntk.', '.kTnNnNnNnNnNTk.',
    '.ktNnNnNnNnNntk.', '.kTnNnNnNnNnNTk.', '.ktTttTttTttTtk.', '.kkkkkkkkkkkkkk.',
  ] },
  crunch: { name: 'Orange combo', pal: { o: '#f28c28', O: '#c2621a', L: '#ff3b3b' }, rows: [
    '................', '.....kkkkkk.....', '.....k....k.....', '.kkkkkkkkkkkkkk.',
    '.kooooooooooook.', '.kokkkkkkkkkkok.', '.kokwkwkwkwkLok.', '.kokkkkkkkkkkok.',
    '.kooooooooooook.', '.kowwwwwwwwwwok.', '.kowWwWwWwWwwok.', '.kowwwwwwwwwwok.',
    '.kowWwWwWwWwwok.', '.kowwwwwwwwwwok.', '.kOOOOOOOOOOOOk.', '.kkkkkkkkkkkkkk.',
  ] },
  lead: { name: 'Half stack', pal: { L: '#ff2d55' }, rows: [
    '................', '.kkkkkkkkkkkkkk.', '.kbbbbbbbbbbbbk.', '.kbyyyyyyyyyybk.',
    '.kbykykykykyLbk.', '.kkkkkkkkkkkkkk.', '.kbbbbbbbbbbbbk.', '.kbGGGGbbGGGGbk.',
    '.kbGkkGbbGkkGbk.', '.kbGGGGbbGGGGbk.', '.kbbbbbbbbbbbbk.', '.kbGGGGbbGGGGbk.',
    '.kbGkkGbbGkkGbk.', '.kbGGGGbbGGGGbk.', '.kBBBBBBBBBBBBk.', '.kkkkkkkkkkkkkk.',
  ] },
  bass: { name: 'Bass fridge', pal: { l: '#3d7bff', L: '#8fd3ff' }, rows: [
    '..kkkkkkkkkkkk..', '..kssssssssssk..', '..kskskskskLsk..', '..kkkkkkkkkkkk..',
    '..kbbbbbbbbbbk..', '..kllllllllllk..', '..kSsSsSsSsSsk..', '..ksSsSsSsSsSk..',
    '..kSsSsSsSsSsk..', '..ksSsSsSsSsSk..', '..kSsSsSsSsSsk..', '..ksSsSsSsSsSk..',
    '..kllllllllllk..', '..kbbbbbbbbbbk..', '..kkkkkkkkkkkk..', '...kk......kk...',
  ] },
};

// A frame as a PNG data URL (scale x scale pixels per sprite pixel). lightOn: the pilot light lit.
export function frame(id, lightOn = true, scale = 4){
  const sp = SPRITES[id], pal = Object.assign({}, BASE, sp.pal), c = document.createElement('canvas');
  c.width = c.height = 16 * scale; const g = c.getContext('2d');
  sp.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if(ch === '.') return;
    g.fillStyle = ch === 'L' && !lightOn ? BASE.k : pal[ch]; g.fillRect(x * scale, y * scale, scale, scale);
  }));
  return c.toDataURL();
}
