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

- `index.html` — the landing page (sign up / sign in, downloads). Invite links (`/?join=`),
  sign-in links coming back and the desktop app go straight on to the jam room.
- `jam/index.html`, `app/` — the jam room at /jam/ (also what the desktop app shows).
- `app/audio/web-io.js` / `native-io.js` — audio in the browser / in the desktop app (same exports).
- `api/` — Vercel functions (`stems.js`: prompt → ElevenLabs music → stems).
- `app/account.js`, `supabase/migrations/` — accounts and jam history (Supabase project
  `kjfhwttykgghpbjjovwu`, free plan). Everyone is signed in silently (anonymous); an email
  makes it a full account. Database rules are in the migration; joining a jam goes through
  `join_jam()`. The publishable key is in the page by design; the secret key and the
  personal access token are never committed. Google sign-in: the button shows once Google
  is on in the project (PATCH /v1/projects/<ref>/config/auth with external_google_enabled,
  external_google_client_id, external_google_secret; redirect URI
  https://kjfhwttykgghpbjjovwu.supabase.co/auth/v1/callback). Manual linking is on, so it
  upgrades the anonymous account.
- `desktop/` — Tauri app (native audio engine in Rust); built by `.github/workflows/desktop.yml`.
- `plugin/` — JUCE "air.band Send" (AU/VST3), streams a DAW track into the app.
- `test/` — unit tests (`npm test`) and browser end-to-end tests (`npm run test:e2e`).
- `download/` — git-ignored; app and plugin downloads, deployed with the site. Files keep
  their version in the name (`air.band-0.6.4-Mac.zip`, …); `APP_VERSION` in `app/main.js` points the links.

## Releasing the desktop app (it auto-updates from 0.6.1)

Bump the version in `desktop/src-tauri/Cargo.toml`, `tauri.conf.json`, `plugin/CMakeLists.txt`
and `APP_VERSION`; push; when the Desktop app workflow passes, put its artifacts in `download/`
(`air.band-<v>-Mac.zip`, `-Windows-setup.exe`, `-Mac.app.tar.gz`, `airband-send-<v>-…zip`), then
`TAURI_SIGNING_PRIVATE_KEY=… node desktop/scripts/release-update.mjs <v>` writes the signed
`download/latest.json`, and deploy. The signing key lives only in the Vercel project's
Development environment variables (`vercel env pull`); lose it and apps can't auto-update.
