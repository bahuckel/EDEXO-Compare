import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: false,
  server: {
    port: 8082,
    strictPort: true,
    /** Cloudflare / tunnel must reach this box; not loopback-only. */
    host: "0.0.0.0",
    /** Without this, requests with Host: edexo.bahuckel.com get "blocked host" from Vite. */
    allowedHosts: true,
  },
  preview: {
    port: 8082,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    outDir: path.resolve(here, "../dist/site"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.join(here, "index.html"),
        privacy: path.join(here, "privacy.html"),
        terms: path.join(here, "terms.html"),
      },
    },
  },
});
