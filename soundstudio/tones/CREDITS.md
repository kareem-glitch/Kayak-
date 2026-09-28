# Built-in tones

Amp models (.nam) and speaker-cabinet impulse responses (.wav) from the
[TONE3000 neural-amp-modeler-wasm](https://github.com/tone-3000/neural-amp-modeler-wasm)
project (MIT licence, see LICENSE-TONE3000). The lead model (lead.nam) was
contributed there by [pipppriss](https://www.tone3000.com/pipppriss).

| File | Source file |
|---|---|
| clean.nam | models/jc.nam |
| warm.nam | models/dumble.nam |
| crunch.nam | models/jcm.nam |
| lead.nam | models/5153.nam |
| bass.nam | models/ampeg.nam |
| guitar-cab.wav | irs/celestion.wav |
| bass-cab.wav | irs/ampeg.wav |

The engine (vendor/nam) is [@opendaw/nam-wasm](https://www.npmjs.com/package/@opendaw/nam-wasm)
1.2.0 by André Michelle, built on Steven Atkinson's
[NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) (MIT).
