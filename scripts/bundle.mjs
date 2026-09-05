import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expressViewStub = path.resolve(__dirname, "express-view-stub.cjs");

mkdirSync("build", { recursive: true });

await esbuild.build({
  entryPoints: ["src/server/devEntry.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "build/app.cjs",
  logLevel: "info",
  plugins: [
    {
      name: "express-view-stub",
      setup(build) {
        build.onResolve({ filter: /^\.\/view$/ }, (args) => {
          const imp = args.importer?.replace(/\\/g, "/") ?? "";
          if (imp.includes("/express/lib/application.js")) {
            return { path: expressViewStub };
          }
        });
      },
    },
  ],
});

console.info("Wrote build/app.cjs");

/**
 * Start the thing we just built and wait for it to say it is listening.
 *
 * The bundle can fail in ways nothing else sees: it is CJS, and `tsx`, `vitest` and `vite` all run
 * the same sources as ESM. `import.meta.url` is the clearest case — esbuild replaces `import.meta`
 * with an empty object in CJS output, so a module that resolves its own directory that way throws
 * *"The 'path' argument must be of type string or an instance of URL"* the moment it is imported.
 * That shipped, and the packaged app would not start, while every test and every dev run passed.
 *
 * Booting it once is the cheapest check that covers the whole class. `--no-smoke` skips it.
 */
async function smokeBoot() {
  const port = 7900 + Math.floor(Math.random() * 80);
  const child = spawn(process.execPath, ["build/app.cjs", "--host", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const done = new Promise((resolve) => {
    const onChunk = (buf) => {
      output += String(buf);
      if (output.includes("HTTP + WS:")) resolve("listening");
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => resolve(`exited with code ${code}`));
    setTimeout(() => resolve("timed out after 90s"), 90_000);
  });

  const outcome = await done;
  child.kill();
  if (outcome !== "listening") {
    console.error(`\n[bundle] build/app.cjs did not start — ${outcome}\n`);
    console.error(output.trim().split("\n").slice(-12).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.info(`Booted build/app.cjs on port ${port} and shut it down again.`);
}

if (!process.argv.includes("--no-smoke")) await smokeBoot();
