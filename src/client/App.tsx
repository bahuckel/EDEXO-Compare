import { useLiveSnapshot } from "./useLiveSnapshot";
import { useToast } from "./ui/feedback";
import { arrivalTripRanks } from "@shared/systemTriage";
import { useCallback, lazy, memo, Suspense, useEffect, useMemo, useState } from "react";
import { JournalBootScreen } from "./JournalBootScreen";
import type { EncyclopediaSpawnCompare } from "./EncyclopediaModal";
import { EliteTipRotator } from "./EliteTipRotator";
import type { AppSnapshot, BodyComputed, FootScannedEntry } from "@shared/types";
import { buildBodyOrbitGroups, groupTabBodiesIntoHostCards } from "./bodyTabGroups";
import { useStableBioTabOrder } from "./useStableBioTabOrder";
import { BodyTabStrip, TabSection } from "./BodyTabStrip";
import { BodyJumpPalette, bodyJumpItems } from "./BodyJumpPalette";
import { BodyPane } from "./BodyPane";
import { HeaderBar } from "./HeaderBar";

/*
 * React first, above the `lazy()` calls below.
 *
 * Vite's dev server pre-bundles React as CJS and rewrites this import into a `const` at the import's
 * own position; with the import further down the file, the `lazy()` calls ran first and the client
 * died on "Cannot access 'lazy' before initialization" — a blank page in `npm run dev`, though the
 * production build hoists correctly and was fine.
 */

















/**
 * Modal-only code, split out of the initial bundle.
 *
 * These four never render on first paint but were downloaded, parsed and executed before it:
 * the system map (plus its 40 KB geometry module, which nothing else imports), the encyclopedia
 * (plus its filter bar and exomastery panels), the habitat match modal, and the quick-facts popup.
 */
const SystemMapModal = lazy(() => import("./SystemMapModal").then((m) => ({ default: m.SystemMapModal })));

const BRAND_AUTHOR = "FALrenica";

function marketingSiteOrigin(): string {
  return import.meta.env.DEV ? "http://127.0.0.1:8082" : "https://edexo.bahuckel.com";
}

/**
 * Idle state: nothing to sample yet.
 *
 * Both art panels used to carry their guidance only in `aria-label` — the one place a sighted user
 * never looks — so the app showed a picture and no instruction. The caption is real text now.
 *
 * This is also the only surface that still shows the brand lockup and the gameplay tip. They used
 * to sit in the header on every screen, costing ~84 px of viewport during play, when the moment
 * they are actually worth reading is the moment there is nothing else on screen.
 */
function BioEmptyState({ snap }: { snap: AppSnapshot }) {
  const dead = snap.fssAllBodiesFoundNoBio === true;
  return (
    <div className="bio-empty-wrap">
      <div
        key={`bio-empty-${snap.viewingSystemAddress ?? snap.currentSystemAddress ?? "na"}-${dead ? "dead" : "fss"}`}
        className={`panel empty${dead ? " panel-empty--dead-system" : " panel-empty--fss-required"}`}
      >
        <div className="bio-empty-caption">
          {/* the launcher's radar scope: sweeping while the FSS is still to come, still on a dead system */}
          <div className="bio-empty-scope" aria-hidden="true" />
          <p className="bio-empty-caption-hed">
            {dead ? "No exobiology in this system" : "No bio signals yet"}
          </p>
          <p className="bio-empty-caption-sub">
            {dead
              ? "Every body here has been scanned and none carry biological signals. Jump to another system, or search one above to browse it from your journal."
              : "FSS a world with biological signals, or DSS map one — bodies appear here on their own. You can also search a visited system above."}
          </p>
          {snap.jumpTarget && !snap.jumpTarget.arrived ? (
            <div className="bio-empty-next" title="From the journal's StartJump: the system you are jumping to and its main star class">
              <span className="fact-k">Next jump</span>
              <span>{snap.jumpTarget.starSystem}</span>
              <span className="bio-empty-next-class">{snap.jumpTarget.starClass}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="brand-hero brand-hero--idle">
        <div className="brand-top-row">
          <img src="/edexo-icon-124.webp" alt="" className="brand-app-icon" width={62} height={62} />
          <div className="brand-title-bordered">
            <div className="logo brand-lockup-title">ED EXO COMPARE</div>
            <div className="brand-byline-muted brand-lockup-byline">by CMDR {BRAND_AUTHOR}</div>
          </div>
        </div>
        <div className="brand-tip-wrap">
          <EliteTipRotator />
        </div>
      </div>
    </div>
  );
}

function AppLegalFooter() {
  const origin = marketingSiteOrigin();
  return (
    <footer className="app-legal-footer">
      <p className="app-legal-footer-note dim">
        ED Exo Compare is owned and operated by Bahuckel™. Independent fan software using local Elite
        Dangerous journal data — not affiliated with Frontier Developments. <em>Elite Dangerous</em> and
        related marks belong to Frontier; all rights reserved by their owners.
      </p>
      <div className="app-legal-footer-links">
        <a href={`${origin}/privacy.html`} target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        <span className="app-legal-footer-sep dim">·</span>
        <a href={`${origin}/terms.html`} target="_blank" rel="noopener noreferrer">
          Terms of Service
        </a>
        <span className="app-legal-footer-sep dim">·</span>
        {/*
          The project's page on the owner's site. Deliberately not `marketingSiteOrigin()`, which is
          still where privacy.html and terms.html live — those are served from the site root and
          moving this link must not quietly move them with it.
        */}
        <a
          href="https://bahuckel.com/projects/edexo-compare"
          target="_blank"
          rel="noopener noreferrer"
        >
          bahuckel.com/projects/edexo-compare
        </a>
      </div>
    </footer>
  );
}

/** One empty list for every render that has no snapshot yet, so its identity holds still. */
const NO_BODIES: BodyComputed[] = [];

export function App() {
  const toast = useToast();
  const { snapshot, connected } = useLiveSnapshot();
  // Shared constant, not a literal: `?? []` mints a new array every render, and anything downstream
  // keyed on its identity treats "still nothing" as "something changed" (§49).
  const rawBodies = snapshot?.bodies ?? NO_BODIES;
  const systemFocusKey = snapshot?.viewingSystemAddress ?? snapshot?.currentSystemAddress ?? null;
  const orderedBodies = useStableBioTabOrder(rawBodies, systemFocusKey);
  const bodyGroups = useMemo(
    () => buildBodyOrbitGroups(orderedBodies, snapshot?.systemMap),
    [orderedBodies, snapshot?.systemMap],
  );
  const multiOrbit = bodyGroups.length > 1;
  const [selectedBodyKey, setSelectedBodyKey] = useState<string | null>(null);
  const [systemMapOpen, setSystemMapOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);

  /**
   * One section per orbit group, host cards inside it. The orbit label used to be a `<select>` that
   * *filtered* the strip; it became a sticky separator, so every body stays reachable in one scroll.
   *
   * The separator carries no text any more. `Near B` above a tab already labelled `B 1` spends a
   * slot of a strip that has to hold every bio body in the system to repeat what the designation
   * says — commanders read the ancestry straight off the name, which is what the name is for. The
   * grouping itself stays: it is what puts a moon next to its planet.
   */
  const tabSections = useMemo<TabSection[]>(
    () =>
      bodyGroups.map((g) => ({
        key: g.key,
        label: null,
        hostCards: groupTabBodiesIntoHostCards(
          orderedBodies.filter((b) => g.bodyKeys.has(b.state.key)),
          snapshot?.systemMap,
        ),
      })),
    [bodyGroups, orderedBodies, snapshot?.systemMap],
  );

  const jumpItems = useMemo(() => {
    const labels = new Map<string, string>();
    if (multiOrbit) {
      for (const g of bodyGroups) for (const k of g.bodyKeys) labels.set(k, g.label);
    }
    return bodyJumpItems(orderedBodies, multiOrbit ? labels : null);
  }, [orderedBodies, bodyGroups, multiOrbit]);

  /**
   * Keep the selection valid in one pass.
   *
   * This was two chained effects — one against `orderedBodies`, one against a filtered `tabBodies`
   * — each calling setState, so a single snapshot could cost three commits. The strip shows every
   * body now, so one list decides; never write the key that is already set.
   */
  useEffect(() => {
    if (!orderedBodies.length) {
      setSelectedBodyKey((k) => (k === null ? k : null));
      return;
    }
    setSelectedBodyKey((k) => {
      if (k && orderedBodies.some((b) => b.state.key === k)) return k;
      const next = orderedBodies[0]!.state.key;
      return next === k ? k : next;
    });
  }, [orderedBodies]);

  /** Ctrl+K anywhere opens the jump palette; the strip itself needs no measurement now. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "k" || ev.key === "K")) {
        ev.preventDefault();
        setJumpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const key = selectedBodyKey;
    const t = window.setTimeout(() => {
      void fetch("/api/ui/selected-body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyKey: key }),
      }).catch(() => {});
    }, 160);
    return () => window.clearTimeout(t);
  }, [selectedBodyKey]);

  useEffect(() => {
    const key = snapshot?.uiAutoSelectBodyKey ?? null;
    if (!key) return;
    setSelectedBodyKey(key);
  }, [snapshot?.uiAutoSelectBodyKey]);

  const selected = orderedBodies.find((b) => b.state.key === selectedBodyKey) ?? orderedBodies[0] ?? null;
  /*
    A2 — the trip, ranked once for the system and read off by whichever body is on screen. Computed
    here rather than in the pane because the comparison is between siblings and the pane only ever
    sees one of them.
  */
  const tripRanks = useMemo(() => arrivalTripRanks(orderedBodies), [orderedBodies]);

  /** Memoized: a fresh object literal here would defeat <HeaderBar>'s memo on every render. */
  const encyclopediaSpawnCompare: EncyclopediaSpawnCompare | null = useMemo(
    () =>
      orderedBodies.length === 0 || !selected
        ? null
        : {
            bodyKey: selected.state.key,
            scan: selected.mergedScan ?? selected.state.scan,
            estimatedSurfaceTempK: selected.estimatedSurfaceTempK,
            speciesMatchContext: selected.speciesMatchContext,
            bodyTabLabel: selected.tabLabel,
          },
    [orderedBodies.length, selected],
  );

  const toggleIncludeBacteriumInSearch = useCallback(() => {
    const snap = snapshot;
    if (!snap || snap.journalBoot) return;
    const bacteriumOn = snap.includeBacteriumInSearch === true;
    void (async () => {
      try {
        const r = await fetch("/api/settings/include-bacterium", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: !bacteriumOn }),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update setting.");
      }
    })();
  }, [snapshot, toast]);

  const focusBodyKey = useCallback((bk: string) => setSelectedBodyKey(bk), []);

  const openJump = useCallback(() => setJumpOpen(true), []);
  const closeJump = useCallback(() => setJumpOpen(false), []);

  const openSystemMap = useCallback(() => setSystemMapOpen(true), []);

  const closeSystemMap = useCallback(() => setSystemMapOpen(false), []);

  const goToBioBodyFromMap = useCallback(
    (bodyKey: string) => {
      focusBodyKey(bodyKey);
      setSystemMapOpen(false);
    },
    [focusBodyKey],
  );

  const footCatalogNavigate = useCallback(
    (e: FootScannedEntry) => {
      void (async () => {
        try {
          const r = await fetch("/api/ui/view-system", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systemAddress: e.systemAddress }),
          });
          const j = (await r.json().catch(() => null)) as { error?: string } | null;
          if (!r.ok) throw new Error(j?.error || r.statusText);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not switch system view.");
        }
      })();
      focusBodyKey(`${e.systemAddress}:${e.bodyId}`);
    },
    [focusBodyKey, toast],
  );

  if (!snapshot) {
    return (
      <div className="app-shell">
        <div className="panel load">Connecting to journal service…</div>
        <AppLegalFooter />
      </div>
    );
  }

  if (snapshot.journalBoot) {
    return (
      <div className="app-shell">
        <JournalBootScreen boot={snapshot.journalBoot} connected={connected} />
        <AppLegalFooter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <HeaderBar
        snap={snapshot}
        connected={connected}
        encyclopediaSpawnCompare={encyclopediaSpawnCompare}
        onOpenSystemMap={openSystemMap}
        onGoToBioBody={focusBodyKey}
        onFootCatalogNavigate={footCatalogNavigate}
      />
      {orderedBodies.length === 0 ? (
        <BioEmptyState snap={snapshot} />
      ) : (
        <div className="body-stage">
          <BodyTabStrip
            sections={tabSections}
            selectedBodyKey={selectedBodyKey}
            onSelect={setSelectedBodyKey}
            onOpenJump={openJump}
            bodyCount={orderedBodies.length}
          />
          {selected ? (
            <BodyPane
              key={selected.state.key}
              body={selected}
              liveRun={
                snapshot.exoOrganicOverlay &&
                snapshot.exoOrganicOverlay.visible === true &&
                snapshot.exoOrganicOverlay.trackingBodyKey === selected.state.key
                  ? {
                      speciesDisplay: snapshot.exoOrganicOverlay.speciesDisplay,
                      sampleCount: snapshot.exoOrganicOverlay.sampleCount,
                    }
                  : null
              }
              trip={tripRanks.get(selected.state.key) ?? null}
              includeBacteriumInSearch={snapshot.includeBacteriumInSearch === true}
              onToggleIncludeBacterium={toggleIncludeBacteriumInSearch}
            />
          ) : null}
        </div>
      )}
      {jumpOpen ? (
        <BodyJumpPalette
          items={jumpItems}
          selectedKey={selectedBodyKey}
          onPick={focusBodyKey}
          onClose={closeJump}
        />
      ) : null}
      {systemMapOpen ? (
        <Suspense fallback={null}>
          <SystemMapModal snap={snapshot} onClose={closeSystemMap} onGoToBioBody={goToBioBodyFromMap} />
        </Suspense>
      ) : null}
      <AppLegalFooter />
    </div>
  );
}
