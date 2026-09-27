# Band relay

Cloudflare Worker + Durable Object that runs one live Lyria RealTime session
per jam room (Google's music model), keeps the API key server-side, and sends
the band's audio to everyone in the room. See the protocol at the top of
`worker.js`. Free-tier friendly: one Google session per room, however many
players.

Deployed by `node deploy.mjs` (needs `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `GEMINI_API_KEY` in the environment).
