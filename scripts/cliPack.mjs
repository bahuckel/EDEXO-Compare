/**
 * The console builds' shared half (Windows `dist-win-cli.mjs`, Linux `dist-linux.mjs`): the two argv
 * wrappers and the pkg call. Moved out of dist-win-cli.mjs on 2026-09-28 unchanged, so the Linux
 * builds start with the same defaults the Windows ones were fixed to.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgBin = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");

/**
 * Thin argv wrappers so @yao-pkg/pkg can build two entrypoints from one bundle.
 *
 * These supply **defaults**, and it matters that they are not overrides. They used to push
 * `--host` unconditionally, and `parseHost` only looks at `--local` / `--lan` when no `--host` is
 * present — so `EDExoCompare-Server-CLI.exe --local` bound `0.0.0.0` anyway, minted a LAN key and
 * printed "On your phone" links, having been asked for loopback only. A flag that is silently
 * ignored is worse than one that is rejected. Found by running the packaged exe, which nothing had
 * done before the first release.
 */
const hostDefault = (host) =>
  `if (!process.argv.some((a) => a === "--host" || a === "--lan" || a === "--local")) process.argv.push("--host", "${host}");\n`;
const portDefault = `if (!process.argv.includes("--port")) process.argv.push("--port", "7111");\n`;

/** Write build/launch-server.cjs and build/launch-client.cjs; returns their paths. */
export function writeCliLaunchers() {
  const launchServer = `${hostDefault("0.0.0.0")}${portDefault}require("./app.cjs");\n`;
  const launchClient = `${hostDefault("127.0.0.1")}${portDefault}if (!process.argv.includes("--open")) process.argv.push("--open");\nrequire("./app.cjs");\n`;
  const server = join("build", "launch-server.cjs");
  const client = join("build", "launch-client.cjs");
  writeFileSync(server, launchServer, "utf8");
  writeFileSync(client, launchClient, "utf8");
  return { server, client };
}

/**
 * One pkg run. `extraArgs` for a cross build: pkg compiles bytecode by running the target's Node,
 * which a Windows machine cannot do for Linux, so the Linux build passes `--no-bytecode --public`.
 */
export function runPkg(tag, label, entry, outFile, target, extraArgs = []) {
  console.info(`[${tag}] ${label} → ${outFile} (pkg ${target})`);
  /** Pkg pulls deps that still `require("punycode")` (Node built-in); Node emits DEP0040 during the packaging run. */
  const prevOpts = process.env.NODE_OPTIONS?.trim() ?? "";
  const pkgNodeOptions = prevOpts ? `${prevOpts} --no-deprecation` : "--no-deprecation";
  const r = spawnSync(
    process.execPath,
    [pkgBin, entry, "--targets", target, "--output", outFile, ...extraArgs],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: pkgNodeOptions },
    },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
