/**
 * A `Status.json` read that failed is not a commander who has left the surface.
 *
 * Those two facts shared one `null` for a long time and it did not matter, because the file was
 * read once a second. It matters now: the read happens on every write *and* every 100 ms, so
 * landing mid-rewrite is routine, and Elite rewrites this file in place. Each torn read cleared the
 * last fix, which blanked the radar for a frame and sent `nearestSampleMeetsMin` through
 * `true -> null -> true`. That is an edge, so the HUD replayed the "far enough to scan now" tone —
 * the owner heard it on every radar update instead of once per boundary crossing.
 *
 * So the parser says *why* it found nothing, the server skips a tick it could not read rather than
 * reporting an absence, and the HUD ignores a frame that does not know. Each of those alone would
 * have hidden the symptom; together they also fix the radar blanking, which is the same defect
 * wearing different clothes.
 */
import { describe, expect, it } from "vitest";
import { readStatusJsonFootFixText, parseStatusJsonFootFix } from "../src/server/footTravelStatus.js";

/** What the game writes while standing on a planet. */
const onFoot = JSON.stringify({
  timestamp: "2026-09-18T23:00:00Z",
  event: "Status",
  Flags: 0,
  Latitude: 12.5,
  Longitude: -40.25,
  Heading: 87,
  PlanetRadius: 2_000_000,
  BodyName: "Probe 1 a",
  Temperature: 180.5,
});

/** What it looks like in the ship: parses cleanly, simply has no position. */
const inShip = JSON.stringify({ timestamp: "2026-09-18T23:00:00Z", event: "Status", Flags: 16_777_240 });

describe("telling a torn read from being off the surface", () => {
  it("reads a real fix", () => {
    const r = readStatusJsonFootFixText(onFoot);
    expect(r.kind).toBe("fix");
    if (r.kind === "fix") {
      expect(r.fix.latDeg).toBe(12.5);
      expect(r.fix.headingDeg).toBe(87);
    }
  });

  it("calls a half-written file unreadable, not off-surface", () => {
    /*
      The actual shape of the bug: Elite rewrites in place, so a read can land on a prefix. This
      must not be reported as "no position" — the previous fix is still the best thing known.
    */
    const torn = onFoot.slice(0, Math.floor(onFoot.length / 2));
    expect(readStatusJsonFootFixText(torn).kind).toBe("unreadable");
    expect(readStatusJsonFootFixText("").kind).toBe("unreadable");
    expect(readStatusJsonFootFixText("{").kind).toBe("unreadable");
  });

  it("calls a clean read with no latitude off-surface, because that is real news", () => {
    // In a ship or in supercruise there genuinely is no surface position, and the radar should go.
    expect(readStatusJsonFootFixText(inShip).kind).toBe("off-surface");
  });

  it("still treats an impossible latitude as off-surface rather than unreadable", () => {
    // It parsed. The numbers are simply not a place, so it is a definite "no", not a failed read.
    const bogus = JSON.stringify({ Latitude: 999, Longitude: 0, PlanetRadius: 2_000_000 });
    expect(readStatusJsonFootFixText(bogus).kind).toBe("off-surface");
  });

  it("keeps the old single-answer helper working for callers that do not care why", () => {
    expect(parseStatusJsonFootFix(onFoot)?.latDeg).toBe(12.5);
    expect(parseStatusJsonFootFix(inShip)).toBeNull();
    expect(parseStatusJsonFootFix("{")).toBeNull();
  });
});
