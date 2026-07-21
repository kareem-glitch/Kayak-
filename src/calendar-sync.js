// Turn scored paddle windows into Google Calendar event payloads.
//
// Pure: no network, no calendar client. A caller (a daily routine, a Telegram
// bot, or a person at the CLI) feeds it the forecast and gets back the exact
// events to create. Keeping it pure means it's testable and the same mapping is
// used everywhere.
//
// Design choices (agreed with the user):
//   - Great + Good windows only — the confident go-times. Low-water "OK" slots
//     are informational in the UI but not calendar-worthy.
//   - Marked FREE (transparent) so they never block meetings or read as busy.
//   - A stable tag in the description lets a sync routine find and clear its own
//     events before re-adding fresh ones, so a changed forecast never leaves a
//     stale "go" behind.

import { paddleWindows, fmtTime, fmtDay } from "./kayak-logic.js";

// Marker string embedded in every event we create, so sync can find them.
export const SYNC_TAG = "wexford-kayak-clock";

// Block off this many minutes before the on-water window for gear/prep, so the
// calendar event starts early enough to actually be ready to launch on time.
export const PREP_MINUTES = 15;

const CALENDAR_WINDOW_VERDICTS = new Set(["great", "good"]);

// "2026-07-20T09:00" (naive Dublin) for the Google Calendar API, paired with
// timeZone: "Europe/Dublin" so DST offsets are resolved server-side.
const localIso = (t) => new Date(t).toISOString().slice(0, 16);

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Build one calendar event object per Great/Good window in the forecast.
// The event starts PREP_MINUTES before the on-water window so there's time to
// rig up; the paddle window itself is spelled out in the description.
export function windowsToEvents(slots, { calendarId = "primary" } = {}) {
  const prepMs = PREP_MINUTES * 60_000;
  return paddleWindows(slots)
    .filter((w) => CALENDAR_WINDOW_VERDICTS.has(w.verdict))
    .map((w) => {
      const tide = w.tide
        ? `${w.tide.type === "high" ? "HW" : "LW"} ${fmtTime(w.tide.time)}`
        : "";
      const wind = `wind ~${Math.round(w.minWind)}kn`;
      return {
        calendarId,
        summary: `🛶 Kayak — Wexford (${cap(w.verdict)})`,
        description:
          `${cap(w.verdict)} paddle window. ${tide}, ${wind}.\n` +
          `Includes ${PREP_MINUTES} min prep — on-water window is ` +
          `${fmtTime(w.start)}–${fmtTime(w.end)}.\n` +
          `Auto-added by the Wexford Kayak Clock. Marked Free — informational, ` +
          `safe to ignore. Always eyeball the water before launching.\n` +
          `[${SYNC_TAG}]`,
        startTime: localIso(w.start - prepMs),
        endTime: localIso(w.end),
        timeZone: "Europe/Dublin",
        availability: "AVAILABILITY_FREE",
        colorId: "7", // Peacock — reads as a water-blue strip on the calendar
        visibility: "private",
      };
    });
}

// Given the events we'd create and the events already on the calendar (each with
// an id, summary, start), decide what to delete and what to create so the
// calendar ends up matching the forecast exactly. Matching is by start-time +
// summary, so an unchanged window is left untouched (no churn).
export function reconcile(desiredEvents, existingEvents) {
  const key = (e) => `${e.startTime?.slice(0, 16) ?? e.start}|${e.summary}`;
  const want = new Map(desiredEvents.map((e) => [key(e), e]));
  const have = new Map(existingEvents.map((e) => [key(e), e]));

  const toCreate = [...want.values()].filter((e) => !have.has(key(e)));
  const toDelete = existingEvents.filter(
    (e) => (e.description ?? "").includes(SYNC_TAG) && !want.has(key(e))
  );
  return { toCreate, toDelete };
}
