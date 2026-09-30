# SoundStudio

A browser jam room for up to 4 players: video, uncompressed live audio, and an
AI backing band that drops out of whichever part a human takes over. Built for
**Live mode**: players within roughly 1,000 km of each other (for example
Ireland, the UK and western Europe), where it can feel close to playing in the
same room.

Live site: https://air.band

## Using it
1. Open the site, type your name, press **Join the jam**. Wear wired headphones.
2. Press **Copy invite link** (or copy the address bar) and send it to up to 3 people.
3. Someone presses **Run the band from here**, picks a prompt, presses play.
4. Players press **I'll play this** on a part; the AI stops playing it for everyone.

Pick your audio interface, input channel and output in **Audio devices**.
Use your interface's direct monitoring to hear yourself; the app never plays
your own instrument back to you.

**Record & check timing**: start the band, press **Record**, and everyone claps
on every beat for ~10 s. You get a stereo take to play back or download (left:
you, right: the others as you heard them, clicks on the band's beat) and a
report of how far ahead or behind the beat each side landed. Your own device's
input/output delay is removed from "you", so "others" shows what the room
really adds.

## How it works
| Piece | What powers it |
|---|---|
| Audio between players | WebRTC data channels, unordered and never retransmitted, carrying raw 16-bit 48 kHz audio in the JackTrip packet format (`audio/hub-protocol.js`). No compression, no echo cancellation or other processing. |
| Room | Everyone connects directly to everyone (max 4). The invite link names the room's creator, who introduces newcomers. A public PeerJS broker makes the introductions; a public TURN relay is a best-effort fallback when networks block direct connections. |
| Backing band | **Google Lyria RealTime** (live AI music): one stream per room through our relay (`relay/`, a Cloudflare Worker that keeps the API key), played on every device at the same moment on the shared clock. Taking a seat mutes drums/bass in the model and drops the part from its prompt. Falls back to the built-in Tone.js band (also `?band=tone`). Band volume is personal. |
| Video | Browser-to-browser WebRTC. |
| Arrangements | `/api/arrange` (Claude, if `ANTHROPIC_API_KEY` is set), otherwise the built-in interpreter. |
| Hosting | Static files and API functions on Vercel. |

## Code layout
```
index.html              the app's markup
app/main.js             join flow and wiring
app/state.js            shared room state, my identity, protocol version
app/session.js          band host, synced start/stop, seats, arrangements
app/ui.js               tiles, band panel, beat display, meters, pickers
app/band/theory.js      chords, styles, built-in prompt interpreter
app/band/engine.js      band start/stop on the shared clock; built-in Tone.js band
app/band/lyria.js       Lyria band: relay connection, synced playback, steering
relay/                  Cloudflare Worker relay for Lyria (deploy: node relay/deploy.mjs)
desktop/                Mac/Windows app with native audio (built by GitHub Actions)
app/audio/io.js         audio context, input/output devices, mixing
app/audio/worklet.js    real-time audio processor (capture + per-player queues + recording tap)
app/audio/analysis.js   onset detection, beat offsets, WAV writer
app/recording.js        Record & check timing
app/net/room.js         4-person mesh, clock sync, packets
audio/hub-protocol.js   JackTrip packet format (shared with the hub)
api/                    Vercel functions (arrangement, hub/LiveKit tokens)
hub/                    self-hosted JackTrip hub server (for bigger rooms or a
                        desktop app later; see hub/README.md)
dev/                    developer pages for testing the hub
vendor/                 self-hosted Tone.js and PeerJS
test/                   unit tests and the end-to-end test
```

## Tests
```
npm install
npm test            # packet format + hub patcher unit tests
npm run test:e2e    # 4 players + a refused 5th, studio quality, recording; headless Chromium, local broker
```
The end-to-end test checks that everyone sees and hears everyone, bands start
in step (including a player who joins mid-song), a taken seat mutes that part
on every device, and a 5th player is turned away.

## Deploying
`vercel deploy --prod` from this folder (or connect the repo in Vercel).
Environment variables (Vercel project settings):
- `ANTHROPIC_API_KEY` (optional): Claude writes the arrangements.
- `HUB_SECRET`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: only for the hub
  developer pages in `dev/`.

## Known limits
- 4 players per room; each uploads to the other 3 (fine on fibre, heavy on slow uplinks).
- The room depends on its creator: if they leave, others stay connected but nobody new can join.
- The introduction broker and TURN relay are free public services; a real launch should run its own.
- Browser audio adds roughly 10–30 ms per device (less on Mac, more on Windows) compared with pro drivers.
- Across continents, real-time tightness isn't physically possible; see "Worldwide mode" in the roadmap.
