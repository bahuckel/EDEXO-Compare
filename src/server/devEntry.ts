import path from "node:path";
import { writeFileSync } from "node:fs";
// `startEdexoFromElectronMode` is deliberately absent here and present in the re-export below:
// `electron/main.cjs` destructures it off this bundle, so the export is load-bearing while the
// import would be dead weight. Only `node scripts/bundle.mjs` catches breaking that.
import { startEdexo, parseCli } from "./edexoBootstrap.js";
import { shouldStartRepl, startRepl } from "../cli/repl.js";

export {
  startEdexo,
  parseCli,
  startEdexoFromElectronMode,
  logFatal,
  assertResourceLayout,
} from "./edexoBootstrap.js";
// `electron/main.cjs` destructures this off the bundle to hand the HTTP layer a way into its overlay
// windows. Load-bearing export with no importer here, exactly like `startEdexoFromElectronMode`.
export { setHudBridge } from "./hudBridge.js";
// Also destructured by `electron/main.cjs`, so its HUD layout lands in the same directory as the
// rest of the user data and honours EDEXO_USER_DATA_DIR.
export { resolveHudLayoutPath } from "./paths.js";

/** Electron main `require()`s this bundle; it must not also run the CLI auto-boot or we bind HTTP twice and exit. */
function shouldRunCliAutoStart(): boolean {
  if (process.env.EDEXO_SKIP_DEVENTRY_AUTOSTART === "1") return false;
  if (typeof (process.versions as { electron?: string }).electron === "string") return false;
  return true;
}

if (shouldRunCliAutoStart()) {
  const cli = parseCli(process.argv.slice(2));
  void startEdexo(cli)
    .then((rt) => {
      const onShutdown = () => void rt.shutdown().then(() => process.exit(0));
      process.on("SIGINT", onShutdown);
      process.on("SIGTERM", onShutdown);

      /*
        The prompt, on an interactive console only.

        A piped or redirected run keeps exactly the behaviour it had before there was a REPL — the
        console builds are used as a background server too, and writing "edexo> " into a log file
        would be a regression for anyone doing that.
      */
      if (shouldStartRepl()) {
        const host = cli.bindHost === "0.0.0.0" ? "127.0.0.1" : cli.bindHost;
        startRepl({ ownBase: `http://${host}:${cli.port}`, onExit: onShutdown });
      }
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
