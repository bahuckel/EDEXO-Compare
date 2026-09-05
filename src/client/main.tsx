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
const SecondScreen = lazy(() =>
  import("./SecondScreen").then((m) => ({ default: m.SecondScreen })),
);

const wantsSecondScreen = new URLSearchParams(window.location.search).get("screen") === "triage";

createRoot(document.getElementById("root")!).render(
  wantsSecondScreen ? (
    <Suspense fallback={null}>
      <SecondScreen />
    </Suspense>
  ) : (
    <UiFeedbackProvider>
      <App />
    </UiFeedbackProvider>
  ),
);
