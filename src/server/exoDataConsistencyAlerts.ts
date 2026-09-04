import type {
  BodyExoState,
  ExoDataAlertDTO,
  GenusHint,
  OrganicGenusLock,
  PlanetScan,
  SpeciesDatabase,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesMatchContext,
} from "../shared/types.js";
import type { PlanetTemperatureBand } from "./matchSpecies.js";
import { speciesMatchesCriteria } from "./matchSpecies.js";
import { estimatedTemperatureRangeForScan } from "./planetTemperature.js";
import {
  loadExomasteryProfile,
  hasExomasteryProfileFile,
  type ExomasteryProfileV1,
} from "./exomasteryProfile.js";
import { getProjectRoot } from "./paths.js";
import { volcanismJournalMatchesFragments } from "../shared/volcanismMatch.js";
import { dssHintsMissingCandidateGenera, resolveSpeciesEntryFromOrganicLock } from "./footScannedCatalog.js";

const PROFILE_VOLCANISM_MISMATCH_FRAC = 0.2;

function lockHasOrganicSpeciesIdentity(lock: OrganicGenusLock): boolean {
  return !!(lock.speciesLocalised?.trim() || lock.speciesSymbol?.trim() || lock.variantLocalised?.trim());
}

function speciesCodexConstrainsVolcanism(c: SpeciesEntry["criteria"]): boolean {
  if (c.volcanismActiveRequired === true) return true;
  const inc = c.volcanismIncludes;
  if (!inc?.length) return false;
  const meaningful = inc.filter((x) => (x ?? "").trim().toUpperCase() !== "ALL");
  return meaningful.length > 0;
}

function profileVolcanismLabelAllowedByCodex(volLabel: string, c: SpeciesEntry["criteria"]): boolean {
  const lo = volLabel.toLowerCase();
  if (lo.includes("no volcanism")) {
    if (c.volcanismActiveRequired === true) return false;
    if (c.volcanismIncludes?.length) return false;
    return true;
  }
  const frags = c.volcanismIncludes;
  if (frags?.some((f) => (f ?? "").trim().toUpperCase() === "ALL")) {
    return true;
  }
  if (!frags?.length) {
    return true;
  }
  return volcanismJournalMatchesFragments(volLabel, frags);
}

function collectProfileVolcanismViolations(
  profile: ExomasteryProfileV1,
  entry: SpeciesEntry,
): { label: string; fraction: number }[] {
  if (!speciesCodexConstrainsVolcanism(entry.criteria)) return [];
  const out: { label: string; fraction: number }[] = [];
  const cat = profile.categorical ?? {};
  for (const [path, counts] of Object.entries(cat)) {
    if (!path.toLowerCase().includes("volcanism")) continue;
    const pairs = Object.entries(counts).filter(([, n]) => typeof n === "number" && n > 0);
    const total = pairs.reduce((s, [, n]) => s + n, 0);
    if (total <= 0) continue;
    for (const [label, n] of pairs) {
      const frac = n / total;
      if (frac < PROFILE_VOLCANISM_MISMATCH_FRAC) continue;
      if (!profileVolcanismLabelAllowedByCodex(label, entry.criteria)) {
        out.push({ label, fraction: Math.round(frac * 1000) / 10 });
      }
    }
  }
  return out;
}

function fixClipboardForEntry(entry: SpeciesEntry, extra?: string): string {
  const root = `data/species/${entry.genusDataDir}/${entry.genusDataDir}_new.json`;
  return extra ? `${root}\n${extra}` : root;
}

function journalFixHintsForOrganicMismatch(
  mc: { reasons: { field: string; detail: string }[] },
  mergedScan: PlanetScan,
  speciesMatchCtx: SpeciesMatchContext | null,
): ExoDataAlertDTO["journalFixHints"] {
  const hints: NonNullable<ExoDataAlertDTO["journalFixHints"]> = {};
  const vol = mergedScan?.Volcanism?.trim();
  if (vol) hints.volcanism = mergedScan.Volcanism;
  const starReason = mc.reasons.find((r) => r.field === "StarType");
  if (starReason && speciesMatchCtx?.parentStarType?.trim()) {
    const d = starReason.detail;
    if (d.includes("need codex fragment")) {
      hints.parentStarType = speciesMatchCtx.parentStarType;
    }
  }
  return Object.keys(hints).length ? hints : undefined;
}

/**
 * On-foot organic identity vs codex JSON + candidate list; feeder profile volcanism vs codex.
 */
export function computeExoDataAlertsForBody(input: {
  body: BodyExoState;
  mergedScan: PlanetScan | null;
  matches: SpeciesMatch[];
  speciesMatchCtx: SpeciesMatchContext | null;
  db: SpeciesDatabase;
}): { alerts: ExoDataAlertDTO[]; dssGenusOrphanHints: GenusHint[] } {
  const { body, mergedScan, matches, speciesMatchCtx, db } = input;
  const alerts: ExoDataAlertDTO[] = [];
  const dssGenusOrphanHints = dssHintsMissingCandidateGenera(body.genusHints, matches);

  if (!mergedScan?.PlanetClass?.trim()) {
    return { alerts, dssGenusOrphanHints };
  }

  /**
   * The game places one genus per biological signal and never the same genus twice, so offering
   * fewer candidate genera than the body reports signals is not uncertainty — it is proof that a
   * gate is excluding a genus that is really there. It needs no landing to detect, which makes it
   * the cheapest data defect in the project to find: measured across the journal cache it fires on
   * 15 of 1,096 bodies.
   */
  const signalCount = body.biologicalSignals;
  if (signalCount != null && Number.isFinite(signalCount) && signalCount > 0) {
    const predictedGenera = new Set(
      matches.filter((m) => !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir),
    );
    if (predictedGenera.size > 0 && predictedGenera.size < signalCount) {
      const short = signalCount - predictedGenera.size;
      alerts.push({
        id: `signal-count-short:${body.key}`,
        severity: "warning",
        detectionSource: "journal",
        title: `${short} genus${short === 1 ? "" : "es"} missing from the candidate list`,
        detail:
          `The journal reports ${signalCount} biological signal(s) on this body, and the game places one genus ` +
          `per signal, but only ${predictedGenera.size} candidate genus/genera pass the current gates ` +
          `(${[...predictedGenera].sort().join(", ")}). At least ${short} genus that is really here is being ` +
          `excluded — a gate is too narrow. Worth recording; nothing on this body needs to be visited to know it.`,
      });
    }
  }

  const est = estimatedTemperatureRangeForScan(mergedScan);
  const planetBand: PlanetTemperatureBand | null = est
    ? { minK: est.tMin, maxK: est.tMax }
    : mergedScan.SurfaceTemperature != null && Number.isFinite(mergedScan.SurfaceTemperature)
      ? { minK: mergedScan.SurfaceTemperature, maxK: mergedScan.SurfaceTemperature }
      : null;
  const estRange =
    est != null
      ? { tMin: est.tMin, tMax: est.tMax, tMid: est.tMid }
      : mergedScan.SurfaceTemperature != null && Number.isFinite(mergedScan.SurfaceTemperature)
        ? (() => {
            const t = mergedScan.SurfaceTemperature!;
            return { tMin: t, tMax: t, tMid: t };
          })()
        : null;

  const matchIds = new Set(matches.map((m) => m.entry.id));
  const root = getProjectRoot();
  const seenErr = new Set<string>();
  const seenWarn = new Set<string>();

  for (const lock of body.organicGenusLocks) {
    if (!lockHasOrganicSpeciesIdentity(lock)) continue;
    const entry = resolveSpeciesEntryFromOrganicLock(lock, db);
    if (!entry) continue;

    const mc = speciesMatchesCriteria(entry, mergedScan, planetBand, estRange, speciesMatchCtx ?? undefined);
    if (!mc.ok) {
      const id = `err-codex-${body.key}-${entry.id}`;
      if (!seenErr.has(id)) {
        seenErr.add(id);
        const detailLines = mc.reasons.map((r) => `• ${r.field}: ${r.detail}`);
        const detail =
          detailLines.length === 1
            ? `Journal organic scan does not match ${entry.genusDataDir}_new.json gates: ${mc.reasons[0]!.detail}`
            : `Journal organic scan does not match ${entry.genusDataDir}_new.json gates:\n${detailLines.join("\n")}`;
        alerts.push({
          id,
          severity: "error",
          detectionSource: "journal",
          speciesEntryId: entry.id,
          genusDataDir: entry.genusDataDir,
          title: `Live scan vs codex — ${entry.displayName}`,
          detail,
          fixClipboard: fixClipboardForEntry(entry, detail),
          journalFixHints: journalFixHintsForOrganicMismatch(mc, mergedScan, speciesMatchCtx ?? null),
        });
      }
      continue;
    }
    if (!matchIds.has(entry.id)) {
      const id = `err-hidden-${body.key}-${entry.id}`;
      if (!seenErr.has(id)) {
        seenErr.add(id);
        alerts.push({
          id,
          severity: "error",
          detectionSource: "journal",
          speciesEntryId: entry.id,
          genusDataDir: entry.genusDataDir,
          title: `Confirmed on foot — not a candidate — ${entry.displayName}`,
          detail:
            "On-foot scan identifies this species, but it is not listed under Candidate species. Check DSS genus hints, Include Bacterium, and other filters.",
          fixClipboard: fixClipboardForEntry(
            entry,
            "Candidate list uses the same scan + DSS filters as matching. Compare this row’s criteria to your journal scan fields.",
          ),
        });
      }
    }
  }

  const profileByEntry = new Map<string, ExomasteryProfileV1>();
  for (const m of matches) {
    const e = m.entry;
    if (!hasExomasteryProfileFile(root, e)) continue;
    if (profileByEntry.has(e.id)) continue;
    const prof = loadExomasteryProfile(root, e);
    if (prof) profileByEntry.set(e.id, prof);
  }

  for (const m of matches) {
    const entry = m.entry;
    const prof = profileByEntry.get(entry.id);
    if (!prof) continue;
    const viol = collectProfileVolcanismViolations(prof, entry);
    if (viol.length === 0) continue;
    const id = `warn-feeder-${body.key}-${entry.id}`;
    if (seenWarn.has(id)) continue;
    seenWarn.add(id);
    const detailParts = viol.map((v) => `“${v.label}” ≈ ${v.fraction}% of feeder samples`);
    const detail = `Exomastery profile has volcanism buckets that conflict with ${entry.genusDataDir}_new.json (≥ ${PROFILE_VOLCANISM_MISMATCH_FRAC * 100}% share):\n${detailParts.map((p) => `• ${p}`).join("\n")}`;
    alerts.push({
      id,
      severity: "warning",
      detectionSource: "exomastery",
      speciesEntryId: entry.id,
      genusDataDir: entry.genusDataDir,
      title: `Feeder vs codex (volcanism) — ${entry.displayName}`,
      detail,
      fixClipboard: fixClipboardForEntry(
        entry,
        `Allowed volcanism fragments: ${(entry.criteria.volcanismIncludes ?? []).join(", ") || "(none — check volcanismActiveRequired)"}. Compare exomastery categorical volcanism keys to codex.`,
      ),
    });
  }

  return { alerts, dssGenusOrphanHints };
}
