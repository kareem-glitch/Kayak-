# SoundStudio live (MVP)

A browser jam room: video tiles, everyone's audio, and an AI backing band on the same screen.
One person runs the band from their device; everyone else hears it and can take parts off the AI.

## What you need
- A LiveKit Cloud account (free tier is fine for testing): https://cloud.livekit.io
- A Vercel account (free): https://vercel.com
- Optional: an Anthropic API key, so Claude writes the arrangements. Without it, the built-in interpreter does.

## Setup (about 20 minutes)
1. In LiveKit Cloud, create a project. From its settings, copy the **WebSocket URL** (starts with `wss://`), the **API key** and the **API secret**.
2. Put this folder in a GitHub repo, then in Vercel choose **Add New > Project** and import it.
   (Or install the Vercel CLI and run `vercel` inside this folder.)
3. In the Vercel project, open **Settings > Environment Variables** and add:
   - `LIVEKIT_URL` = your wss:// URL
   - `LIVEKIT_API_KEY` = your API key
   - `LIVEKIT_API_SECRET` = your API secret
   - `ANTHROPIC_API_KEY` = your Anthropic key (optional)
4. Redeploy. Open the site. It creates a room link like `https://your-site.vercel.app/?room=jam-ab12c`. Send that link to the players.

## Running a session
- Everyone opens the link, types a name, and joins. Wired headphones only.
- One person presses **Run the band from here**, types a prompt, and presses play.
- Players press **I'll play this** on a part to take it. The AI drops that part for everyone.

## Known limits of this MVP
- Audio travels over WebRTC, so it's looser than JackTrip. Fine for spotlight soloing, loose comping and testing the idea; tight rhythm locking needs the later JackTrip-based desktop app.
- The band's sounds are synthesised in the host's browser (Tone.js), so they're sketches, not studio audio.
- Rooms aren't private: anyone with the link can join.

## Test locally
`npm install`, then `npx vercel dev` with the same environment variables in a `.env` file.
