import path from "node:path";
import { writeFileSync } from "node:fs";
import { startEdexo, parseCli, startEdexoFromElectronMode } from "./edexoBootstrap.js";

export { startEdexo, parseCli, startEdexoFromElectronMode, logFatal, assertResourceLayout } from "./edexoBootstrap.js";

/** Electron main `require()`s this bundle; it must not also run the CLI auto-boot or we bind HTTP twice and exit. */
function shouldRunCliAutoStart(): boolean {
  if (process.env.EDEXO_SKIP_DEVENTRY_AUTOSTART === "1") return false;
  if (typeof (process.versions as { electron?: string }).electron === "string") return false;
  return true;
}

if (shouldRunCliAutoStart()) {
  void startEdexo(parseCli(process.argv.slice(2)))
    .then((rt) => {
      const onShutdown = () => void rt.shutdown().then(() => process.exit(0));
      process.on("SIGINT", onShutdown);
      process.on("SIGTERM", onShutdown);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

process.on("uncaughtException", (e) => {
  console.error("uncaughtException:", e);
  try {
    writeFileSync(
      path.join(path.dirname(process.execPath), "edexo-compare-crash.log"),
      String(e && (e as Error).stack ? (e as Error).stack : e),
      "utf8",
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection:", e);
  process.exit(1);
});
