import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { promises as fsp } from "node:fs";
import express from "express";
import { getSpeciesDataDir } from "../paths.js";
import { findGenusPhotosFolder, findGenusNotesFile } from "../speciesTreeLoader.js";

import type { HttpServerOptions, RouteContext } from "../httpServer.js";
import { assertInsideDir } from "./httpHelpers.js";

export function registerSpeciesFilesRoutes(
  app: express.Express,
  _opts: HttpServerOptions,
  ctx: RouteContext,
): void {
  const { root } = ctx;
  app.get("/photos/__builtin_placeholder.svg", (_req, res) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220"><rect width="100%" height="100%" fill="#12121a"/><rect x="12" y="12" width="336" height="196" fill="none" stroke="#ff6a1a" stroke-opacity="0.45" stroke-width="2"/><text x="180" y="100" fill="#c8c4bf" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13">No species photo on disk</text><text x="180" y="128" fill="#ff6a1a" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12">Add images under data/species/&lt;genus&gt;/*_photos/</text></svg>`;
    res.type("image/svg+xml").send(svg);
  });

  /**
   * Species artwork. Opening the encyclopedia used to fire ~108 of these at once, and each request
   * did three synchronous fs calls plus a directory scan on the event loop — requests stalled and
   * the browser fell back to the "no photo on disk" placeholder. Now: cached directory lookup,
   * async stat, and a week of client caching so reopening the modal costs nothing.
   */
  const SPECIES_PHOTO_MAX_AGE_S = 604_800;
  app.get("/species-photos/:genusDir/:file", (req, res) => {
    void (async () => {
      const genusDir = String(req.params.genusDir);
      const file = path.basename(String(req.params.file));
      if (!genusDir || genusDir.includes("..") || /[/\\]/.test(genusDir)) {
        res.status(400).end();
        return;
      }
      const speciesBase = getSpeciesDataDir(root);
      const genusPath = path.join(speciesBase, genusDir);

      if (!assertInsideDir(speciesBase, genusPath)) {
        res.status(403).end();
        return;
      }
      const photosDir = findGenusPhotosFolder(genusPath, genusDir);
      if (!photosDir) {
        res.status(404).end();
        return;
      }
      // ?size=thumb|card|large serves the generated WebP derivative (npm run images) and silently
      // falls back to the original, so hand-added artwork keeps working until derivatives are rebuilt.
      // "large" is the lightbox's 2048 px (owner, 2026-10-04), generated at build time.
      const size = String(req.query.size ?? "");
      const derivativeDir =
        size === "thumb" ? "_thumbs" : size === "card" ? "_cards" : size === "large" ? "_large" : null;
      let abs = path.join(photosDir, file);
      if (derivativeDir) {
        const stem = file.replace(/\.[^.]+$/, "");
        const candidate = path.join(photosDir, derivativeDir, `${stem}.webp`);
        if (assertInsideDir(photosDir, candidate)) {
          try {
            if ((await fsp.stat(candidate)).isFile()) abs = candidate;
          } catch {
            /* fall back to the original */
          }
        }
      }
      if (!assertInsideDir(photosDir, abs)) {
        res.status(403).end();
        return;
      }
      {
        // A packaged build ships the 2048 px lightbox image, else the 1024 px card, in place of the
        // original (review F-4.1c): a request for the original, or for a derivative not generated on
        // this tree, lands on the best of them that exists.
        const stem = file.replace(/\.[^.]+$/, "");
        for (const dir of ["_large", "_cards"]) {
          try {
            await fsp.stat(abs);
            break;
          } catch {
            const alt = path.join(photosDir, dir, `${stem}.webp`);
            if (assertInsideDir(photosDir, alt)) abs = alt;
          }
        }
      }
      try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) {
          res.status(404).end();
          return;
        }
      } catch {
        res.status(404).end();
        return;
      }
      res.setHeader("Cache-Control", `public, max-age=${SPECIES_PHOTO_MAX_AGE_S}`);
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) res.status(404).end();
      });
    })();
  });

  app.get("/api/genus-notes/:genusDir", (req, res) => {
    const genusDir = String(req.params.genusDir);
    if (!genusDir || genusDir.includes("..") || /[/\\]/.test(genusDir)) {
      res.status(400).type("text/plain").send("Invalid genus parameter.");
      return;
    }
    const speciesBase = getSpeciesDataDir(root);
    const genusPath = path.join(speciesBase, genusDir);
    if (!assertInsideDir(speciesBase, genusPath)) {
      res.status(400).type("text/plain").send("Invalid genus path.");
      return;
    }
    if (!existsSync(genusPath) || !statSync(genusPath).isDirectory()) {
      res.status(404).type("text/plain").send("Genus folder not found.");
      return;
    }
    const notesPath = findGenusNotesFile(genusPath, genusDir);
    if (!notesPath) {
      res.status(404).type("text/plain").send("No *notes*.txt file in this genus folder.");
      return;
    }
    try {
      const text = readFileSync(notesPath, "utf8");
      res.type("text/plain; charset=utf-8").send(text);
    } catch {
      res.status(500).type("text/plain").send("Could not read notes file.");
    }
  });

  app.get("/api/exomastery-feeder-json/:genusDir/:basename", (req, res) => {
    const genusDir = String(req.params.genusDir);
    const basename = path.basename(String(req.params.basename));
    if (!genusDir || genusDir.includes("..") || /[/\\]/.test(genusDir)) {
      res.status(400).json({ error: "Invalid genus parameter." });
      return;
    }
    if (!basename || basename.includes("..")) {
      res.status(400).json({ error: "Invalid file name." });
      return;
    }
    const speciesBase = getSpeciesDataDir(root);
    const genusPath = path.join(speciesBase, genusDir);
    if (!assertInsideDir(speciesBase, genusPath)) {
      res.status(403).end();
      return;
    }
    if (!existsSync(genusPath) || !statSync(genusPath).isDirectory()) {
      res.status(404).json({ error: "Genus folder not found." });
      return;
    }
    const absRoot = path.join(genusPath, basename);
    const absSub = path.join(genusPath, "exomastery", basename);
    let abs = absRoot;
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      abs = absSub;
    }
    if (!assertInsideDir(genusPath, abs)) {
      res.status(403).end();
      return;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      res.status(404).json({ error: "Exomastery profile not found." });
      return;
    }
    if (!basename.endsWith(".json")) {
      res.status(400).json({ error: "Only JSON exports are allowed." });
      return;
    }
    try {
      const raw = readFileSync(abs, "utf8");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
      res.send(raw);
    } catch {
      res.status(500).json({ error: "Could not read file." });
    }
  });
}
