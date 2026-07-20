#!/usr/bin/env node
// CLI: prints the week's paddle windows for Wexford Harbour.
// This is the same logic the web UI uses, and what a Telegram bot would call.

import {
  API,
  SPOT,
  buildForecast,
  paddleWindows,
  fmtDay,
  fmtTime,
} from "./kayak-logic.js";

const [weather, marine] = await Promise.all(
  [API.weather(SPOT.lat, SPOT.lon), API.marine(SPOT.lat, SPOT.lon)].map(
    async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} from ${url}`);
      return res.json();
    }
  )
);

const { slots, tides } = buildForecast(weather, marine);
const windows = paddleWindows(slots);

console.log(`Wexford Kayak Clock — ${SPOT.name}\n`);

if (windows.length === 0) {
  console.log("No paddleable windows in the next 7 days. Blame the wind.");
} else {
  console.log("Paddle windows this week:");
  for (const w of windows) {
    const label = { great: "GREAT", good: "GOOD ", ok: "OK   " }[w.verdict];
    const tide =
      w.tide.type === "high"
        ? `HW ${fmtTime(w.tide.time)}`
        : `LW ${fmtTime(w.tide.time)}`;
    console.log(
      `  ${label} ${fmtDay(w.start)}  ${fmtTime(w.start)}–${fmtTime(w.end)}` +
        `  wind ${w.minWind.toFixed(0)}kn  ${tide}`
    );
  }
}

console.log("\nTides:");
let day = "";
for (const e of tides) {
  const d = fmtDay(e.time);
  if (d !== day) {
    day = d;
    process.stdout.write(`\n  ${d}  `);
  }
  process.stdout.write(
    `${e.type === "high" ? "HW" : "LW"} ${fmtTime(e.time)} (${e.height.toFixed(1)}m)  `
  );
}
console.log();
