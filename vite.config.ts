import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/*
  The API the dev server proxies to. The e2e smoke (playwright.config.ts) runs its own API on
  another port so a packaged app already on 7111 can never answer for the fixture journal.
*/
const API = `127.0.0.1:${process.env.EDEXO_DEV_API_PORT || "7111"}`;
const DEV_PORT = Number(process.env.EDEXO_DEV_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  publicDir: "../../public",
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "src/shared") },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      "/api": { target: `http://${API}`, changeOrigin: true },
      "/photos": { target: `http://${API}`, changeOrigin: true },
      // The species images the panel actually asks for. Without this the dev server answers with
      // its SPA fallback — HTTP 200, an HTML body, and every card showing "Image failed to load".
      "/species-photos": { target: `http://${API}`, changeOrigin: true },
      "/ws": { target: `ws://${API}`, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // React changes far less often than app code; keeping it in its own chunk means a release
        // only invalidates the app chunk in the browser cache.
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client"],
        },
      },
    },
  },
});
