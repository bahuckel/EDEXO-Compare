/**
 * Slim snapshots per client kind (owner, 2026-09-13, "snapshot deltas" — the root fix for the
 * launcher's heaviness).
 *
 * One snapshot used to go to every socket: the app needs all of it, the HUD reads sixteen fields
 * and one body's candidate rows, the launcher reads five. Each socket now says what it is
 * (`{ type: "hello", channel }`) and gets a payload cut to that. The app keeps the full state, less
 * each candidate's detail, which it fetches when it opens it (`slimMatchForApp`).
 */
import { createHash } from "node:crypto";
import type { AppSnapshot, BodyComputed } from "../shared/types.js";

export type WsChannel = "app" | "hud" | "launcher";

export function parseWsChannel(v: unknown): WsChannel | null {
  return v === "app" || v === "hud" || v === "launcher" ? v : null;
}

/** Everything `public/hud/` reads off the snapshot (`d.<key>`), plus the bodies it looks up. */
const HUD_KEYS = [
  "port",
  "journalBoot",
  "currentRegion",
  "exoOverlayFocusBodyKey",
  "exoOverlayFocusBody",
  "exoOrganicOverlay",
  "exoMinimap",
  "statusDestination",
  "jumpTarget",
  "dScanBodies",
  "liveShipFuelRange",
  "organicDataValueCredits",
  "organicPendingSampleCount",
  "explorationScanDataValueCredits",
  "includeExplorationScanDataInDataValue",
  "hudPrefs",
  "trackedAchievement",
  // The Notable and Notices overlays (2026-09-30); notices are cut down below.
  "notableBodies",
  "notices",
] as const satisfies readonly (keyof AppSnapshot)[];

/** What the launcher's `applyLauncherSnapshotData` reads; its live strip polls `/api/status` on its own. */
const LAUNCHER_KEYS = [
  "port",
  "journalBoot",
  "journalDir",
  "journalDirConfiguredOk",
  "journalFileCount",
  "lastJournalEventIso",
] as const satisfies readonly (keyof AppSnapshot)[];

/** A body as the HUD's candidate list needs it: the journal state, the label, the rows' essentials. */
export function slimBodyForHud(b: BodyComputed): Partial<BodyComputed> {
  return {
    state: b.state,
    tabLabel: b.tabLabel,
    matches: b.matches.map((m) => ({
      entry: {
        id: m.entry.id,
        displayName: m.entry.displayName,
        genus: m.entry.genus,
        genusDataDir: m.entry.genusDataDir,
        // Rarity and new-codex marks for the candidate rows (guild tester, 2026-09-30): the tier only.
        ...(m.entry.rarity ? { rarity: { tier: m.entry.rarity.tier } } : {}),
      },
      ...(m.regionRarity?.found && m.regionRarity.tier
        ? { regionRarity: { region: m.regionRarity.region, found: true, tier: m.regionRarity.tier } }
        : {}),
      ...(m.codexNew ? { codexNew: true } : {}),
      priceCredits: m.priceCredits,
      presenceProbabilityPercent: m.presenceProbabilityPercent,
      unlikely: m.unlikely,
      organicAnalysisComplete: m.organicAnalysisComplete,
      sampledHere: m.sampledHere,
      exomasterySimilarityPercent: m.exomasterySimilarityPercent,
    })) as unknown as BodyComputed["matches"],
  };
}

type Match = BodyComputed["matches"][number];

/** Same test as the client's `exomasteryDetailHasContent`: is there anything for the modal to draw? */
function detailHasContent(d: Match["exomasteryDetail"]): boolean {
  if (!d) return false;
  if ((d.stats?.length ?? 0) > 0) return true;
  if ((d.atmosphereClimateStats?.length ?? 0) > 0) return true;
  return (d.compositionGroups ?? []).some((g) => g.rows.length > 0);
}

/*
  The habitat detail of each candidate (distributions with their bins, per body and species) and its
  "other matching details" cards are ~95 % of a rich system's `bodies` — 3.1 of 3.3 MB for 56
  candidates — and are only read when the commander opens a card's habitat modal or its drawer (UI
  review P1b, 2026-09-29). The app channel leaves them out and marks the match with `lazyDetail`; the
  card fetches them from `/api/match-detail` when it needs them. `v` is a hash of what was left out,
  so the match still changes on the wire when only its detail does and the card fetches it again.
*/
function slimMatchForApp(m: Match, bodyKey: string): Match {
  if (m.exomasteryDetail === undefined && m.exomasteryVarietyHints === undefined && m.otherMatchDetailCards === undefined) {
    return m;
  }
  const { exomasteryDetail, exomasteryVarietyHints: _hints, otherMatchDetailCards, ...rest } = m;
  const habitat = detailHasContent(exomasteryDetail);
  const otherCards = otherMatchDetailCards?.length ?? 0;
  if (!habitat && otherCards === 0) return rest;
  const v = createHash("sha1")
    .update(JSON.stringify([exomasteryDetail, _hints, otherMatchDetailCards]))
    .digest("base64")
    .slice(0, 10);
  return { ...rest, lazyDetail: { body: bodyKey, habitat, otherCards, v } };
}

export function slimBodyForApp(b: BodyComputed): BodyComputed {
  return { ...b, matches: b.matches.map((m) => slimMatchForApp(m, b.state.key)) };
}

/** The detail the app channel left out, looked up in a full snapshot; null when the match is gone. */
export function findMatchDetail(
  snap: AppSnapshot,
  bodyKey: string,
  speciesId: string,
): Pick<Match, "exomasteryDetail" | "exomasteryVarietyHints" | "otherMatchDetailCards"> | null {
  const bodies = [...(snap.bodies ?? []), ...(snap.exoOverlayFocusBody ? [snap.exoOverlayFocusBody] : [])];
  for (const b of bodies) {
    if (b.state.key !== bodyKey) continue;
    const m = b.matches.find((x) => x.entry.id === speciesId);
    if (m) {
      return {
        exomasteryDetail: m.exomasteryDetail ?? null,
        exomasteryVarietyHints: m.exomasteryVarietyHints ?? null,
        otherMatchDetailCards: m.otherMatchDetailCards ?? null,
      };
    }
  }
  return null;
}

export function slimSnapshotForChannel(snap: AppSnapshot, channel: WsChannel): Partial<AppSnapshot> {
  if (channel === "app") {
    return {
      ...snap,
      bodies: snap.bodies ? snap.bodies.map(slimBodyForApp) : snap.bodies,
      exoOverlayFocusBody: snap.exoOverlayFocusBody ? slimBodyForApp(snap.exoOverlayFocusBody) : snap.exoOverlayFocusBody,
    };
  }
  const out: Record<string, unknown> = {};
  const keys: readonly (keyof AppSnapshot)[] = channel === "hud" ? HUD_KEYS : LAUNCHER_KEYS;
  for (const k of keys) out[k] = snap[k];
  if (channel === "hud") {
    out.bodies = (snap.bodies ?? []).map(slimBodyForHud);
    if (snap.exoOverlayFocusBody) out.exoOverlayFocusBody = slimBodyForHud(snap.exoOverlayFocusBody);
    // The HUD shows the newest few and a count; the whole unread list stays with the app.
    if (snap.notices) out.notices = { ...snap.notices, items: snap.notices.items.slice(0, 5), unread: snap.notices.items.length };
  }
  return out as Partial<AppSnapshot>;
}
