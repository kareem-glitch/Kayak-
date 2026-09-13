# Kayak

Two small, dependency-free web tools that live in this repo:

- **[Wexford Kayak Clock](#wexford-kayak-clock-)** — when to paddle, from wind and tide.
- **[Diglot](diglot/)** — read English with Spanish woven in, at a difficulty you
  set with a slider, and export it to your Kindle. See [diglot/README.md](diglot/README.md).

---

# Wexford Kayak Clock 🛶

Tells you when it's a good time to paddle in Wexford Harbour. No accounts, no
API keys — wind comes from [Open-Meteo](https://open-meteo.com) and tide height
from the Open-Meteo Marine API, both free public endpoints.

## The rules it scores against

Each daylight hour (08:00–19:00, Dublin time) over the next 7 days gets a verdict:

| Verdict | Meaning |
|---|---|
| **Great** | wind ≤ 6kn and within ±1h of high water |
| **Good** | wind < 10kn and within ±1h of high water |
| **OK** | wind < 10kn and within ±1h of low water (the fallback option) |
| **No-go** | wind ≥ 10kn, or mid-tide |

Gusts ≥ 16kn demote a slot one step. Hourly slots mean every paddleable slot is
already a ≥1-hour window; consecutive slots are merged into windows like
"Tue 10:00–12:00".

High-water timings are interpolated from the hourly sea-level series with a
quadratic fit, so they're good to a few minutes. Heights are relative to mean
sea level, not chart datum — use them for timing, not depth.

## Run it

**Web UI** — serve the folder and open it (module imports need http, not `file://`):

```sh
npm run serve   # then open http://localhost:8080
```

**CLI** — prints the week's paddle windows and tide times:

```sh
npm run forecast
```

**Tests:**

```sh
npm test
```

**Diglot** — serve the folder and open `http://localhost:8080/diglot/`, or open
`diglot/diglot.html` directly. Rebuild that single-file bundle with
`npm run build:diglot`.

## Layout

- `src/kayak-logic.js` — all scoring logic as pure functions (tide extraction,
  slot scoring, window merging). This is the module a Telegram bot would import.
- `src/forecast.js` — CLI wrapper.
- `index.html` — self-contained web UI (7-day grid, tooltips, dark mode,
  refreshes hourly).
- `test/logic.test.js` — logic tests against a synthetic tide.

Tweak the thresholds in `DEFAULT_RULES` in `src/kayak-logic.js`.

This is a forecast, not a lifeguard — always check the water before launching.
