import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  publicDir: "../../public",
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "src/shared") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:7111", changeOrigin: true },
      "/photos": { target: "http://127.0.0.1:7111", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:7111", ws: true, changeOrigin: true },
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
