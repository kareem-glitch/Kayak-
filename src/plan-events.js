#!/usr/bin/env node
// Prints the calendar events that SHOULD exist for the next 7 days, as JSON.
// The daily sync run calls this, lists the calendar's existing tagged events,
// then creates the missing ones and deletes any tagged event not in this list.
//
//   node src/plan-events.js
//   -> { "calendarId": "...", "syncTag": "wexford-kayak-clock", "events": [ ... ] }

import { API, SPOT, buildForecast } from "./kayak-logic.js";
import { windowsToEvents, SYNC_TAG } from "./calendar-sync.js";

const CALENDAR_ID = process.env.KAYAK_CALENDAR_ID || "kareem@bonafide.fm";

const [weather, marine] = await Promise.all(
  [API.weather(SPOT.lat, SPOT.lon), API.marine(SPOT.lat, SPOT.lon)].map(
    async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} from ${url}`);
      return res.json();
    }
  )
);

const { slots } = buildForecast(weather, marine);
const events = windowsToEvents(slots, { calendarId: CALENDAR_ID });

console.log(
  JSON.stringify({ calendarId: CALENDAR_ID, syncTag: SYNC_TAG, events }, null, 2)
);
