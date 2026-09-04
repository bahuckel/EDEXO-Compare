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
