import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import "./styles.css";
import { App } from "./App";
import { UiFeedbackProvider } from "./ui/feedback";

/**
 * `?screen=triage` gets the second screen (§51) instead of the app.
 *
 * A query parameter rather than a router: this app has exactly two views and no history to manage,
 * and a bookmark on a phone is the whole delivery mechanism. Lazy so the main app does not carry it.
 */
const SecondScreen = lazy(() => import("./SecondScreen").then((m) => ({ default: m.SecondScreen })));
/** `?screen=map` gets the galaxy sector map (Phase 10). Lazy for the same reason. */
const GalaxyMapScreen = lazy(() => import("./GalaxyMapScreen").then((m) => ({ default: m.GalaxyMapScreen })));

const screen = new URLSearchParams(window.location.search).get("screen");
const wantsSecondScreen = screen === "triage";
const wantsMap = screen === "map";

createRoot(document.getElementById("root")!).render(
  wantsMap ? (
    <Suspense fallback={null}>
      <GalaxyMapScreen />
    </Suspense>
  ) : wantsSecondScreen ? (
    <Suspense fallback={null}>
      <SecondScreen />
    </Suspense>
  ) : (
    <UiFeedbackProvider>
      <App />
    </UiFeedbackProvider>
  ),
);
