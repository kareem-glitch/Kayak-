# air.band

Jam room: up to 4 players, low-latency audio, BARS (trading bars), an AI band.
Live at https://air.band (Vercel project `soundstudio`; the old soundstudio-wine.vercel.app still works).

## Rules

- **Browser, desktop app and plugin stay in step.** Anything added or changed in the
  browser must work the same in the desktop app (`desktop/`) and, where it applies, the
  DAW plugin (`plugin/`), in the same change or the one straight after. The app loads the
  live site, so page-only changes carry over automatically; anything that touches audio
  (tones, synth, delay test, input/output) needs its native counterpart in
  `app/audio/native-io.js` + `desktop/src-tauri`. Names, look (the Roland P-6 theme) and
  version numbers match everywhere.
- Latency is the core experience: never add work to the audio path lightly, and keep the
  page light while playing.
- Ask before creating paid cloud resources or anything that costs money.
- Never commit secrets. Use environment variables and a git-ignored `.env`.
- Prefer small, reviewable changes over big rewrites.
- Stop at the end of each phase and summarise what was done, what works, what doesn't and
  what's needed from the owner.

## Layout

- `index.html`, `app/` — the site (also what the desktop app shows).
- `app/audio/web-io.js` / `native-io.js` — audio in the browser / in the desktop app (same exports).
- `api/` — Vercel functions (`stems.js`: prompt → ElevenLabs music → stems).
- `desktop/` — Tauri app (native audio engine in Rust); built by `.github/workflows/desktop.yml`.
- `plugin/` — JUCE "air.band Send" (AU/VST3), streams a DAW track into the app.
- `test/` — unit tests (`npm test`) and browser end-to-end tests (`npm run test:e2e`).
- `download/` — git-ignored; app and plugin downloads, deployed with the site.
