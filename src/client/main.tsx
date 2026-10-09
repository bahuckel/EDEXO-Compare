import { HexSignals } from "./HexSignals";
import { createRoot } from "react-dom/client";
import { lazy, Suspense, useEffect, useState } from "react";
import "./styles.css";
import { App } from "./App";
import { UiFeedbackProvider } from "./ui/feedback";
import { LoadingNote } from "./ui/Loading";
import { applyAppTheme, followAppThemeChanges } from "./appTheme";
import { applyStreamerMode, STREAMER_MODE } from "./streamerMode";
import { loadUiMirror, startUiMirrorSource, watchUiMirror } from "./uiMirror";

// The streamer view takes the streamer's own settings first (uiMirror.ts), so even its first paint
// is what the streamer sees.
const mirrorRev = STREAMER_MODE ? await loadUiMirror() : -1;
// The colour scheme, before the first paint, so the page never flashes orange first; and again when
// another window of the app changes it.
applyAppTheme();
followAppThemeChanges();
// `?view=stream`: the same app, as a picture for a stream (streamerMode.ts).
applyStreamerMode();

/**
 * `?screen=triage` gets the second screen (§51) instead of the app.
 *
 * A query parameter rather than a router: this app has exactly two views and no history to manage,
 * and a bookmark on a phone is the whole delivery mechanism. Lazy so the main app does not carry it.
 */
const SecondScreen = lazy(() => import("./SecondScreen").then((m) => ({ default: m.SecondScreen })));
/** `?screen=map` gets the galaxy sector map (Phase 10). Lazy for the same reason. */
const GalaxyMapScreen = lazy(() => import("./GalaxyMapScreen").then((m) => ({ default: m.GalaxyMapScreen })));

/**
 * `?screen=galaxy`: the 3D galaxy map (docs/galaxy-plan-28092026.md). Lazy like the others, and it
 * carries three.js, so the main app never downloads it.
 */
const GalaxyMap3D = lazy(() => import("./GalaxyMap3D").then((m) => ({ default: m.GalaxyMap3D })));

const screen = new URLSearchParams(window.location.search).get("screen");
const wantsSecondScreen = screen === "triage";
const wantsMap = screen === "map";
const wants3d = screen === "galaxy";

/** The streamer view, drawn afresh whenever the streamer changes a setting in the app. */
function StreamerApp() {
  const [gen, setGen] = useState(0);
  useEffect(() => {
    watchUiMirror(mirrorRev, () => {
      applyAppTheme();
      setGen((g) => g + 1);
    });
  }, []);
  return <App key={gen} />;
}
// The app on this PC tells the streamer view how it is set up.
if (!STREAMER_MODE && !screen) startUiMirrorSource();

createRoot(document.getElementById("root")!).render(
  wants3d ? (
    <Suspense fallback={<LoadingNote className="screen-loading" />}>
      <GalaxyMap3D />
    </Suspense>
  ) : wantsMap ? (
    <Suspense fallback={<LoadingNote className="screen-loading" />}>
      <GalaxyMapScreen />
    </Suspense>
  ) : wantsSecondScreen ? (
    <Suspense fallback={<LoadingNote className="screen-loading" />}>
      <SecondScreen />
    </Suspense>
  ) : (
    <UiFeedbackProvider>
      <HexSignals />
      {STREAMER_MODE ? <StreamerApp /> : <App />}
    </UiFeedbackProvider>
  ),
);
