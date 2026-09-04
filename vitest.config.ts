import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * `src/**` uses NodeNext-style specifiers (`./foo.js`) that TypeScript resolves to `./foo.ts`.
 * Vite resolves relative specifiers literally, so without this every server import fails to load.
 * Rewrites only when the sibling `.ts` / `.tsx` actually exists, so real `.js` files still win.
 */
function resolveTsFromJsSpecifier() {
  return {
    name: "edexo-resolve-ts-from-js",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const abs = path.resolve(path.dirname(importer), source);
      for (const ext of [".ts", ".tsx"]) {
        const candidate = `${abs.slice(0, -".js".length)}${ext}`;
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveTsFromJsSpecifier()],
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "src/shared") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The species-database tests read data/species/**; keep them off the same worker clock as the
    // pure-function suites so a slow first read cannot fail an unrelated file.
    testTimeout: 20_000,
  },
});
