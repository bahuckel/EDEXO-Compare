/**
 * The lightbox's 2048 px photo (owner, 2026-10-04): `?size=large` serves `_large/<stem>.webp`, and a
 * tree without it — a packaged build has no originals — falls back to the best image there is.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerSpeciesFilesRoutes } from "../src/server/routes/speciesFilesRoutes.js";
import type { HttpServerOptions, RouteContext } from "../src/server/httpServer.js";

let root: string;
let base: string;
let close: () => void;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-photo-large-"));
  const photos = path.join(root, "data", "species", "aleoida", "aleoida_photos");
  for (const d of ["_cards", "_large"]) mkdirSync(path.join(photos, d), { recursive: true });
  // "both": original, card and large. "packaged": card and large only. "cardonly": a card only.
  writeFileSync(path.join(photos, "both.jpg"), "original");
  writeFileSync(path.join(photos, "_cards", "both.webp"), "card");
  writeFileSync(path.join(photos, "_large", "both.webp"), "large");
  writeFileSync(path.join(photos, "_cards", "packaged.webp"), "card");
  writeFileSync(path.join(photos, "_large", "packaged.webp"), "large");
  writeFileSync(path.join(photos, "_cards", "cardonly.webp"), "card");
  const app = express();
  registerSpeciesFilesRoutes(app, {} as HttpServerOptions, { root, webRoot: root } as RouteContext);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/species-photos/aleoida`;
  close = () => server.close();
});
afterAll(() => {
  close();
  rmSync(root, { recursive: true, force: true });
});

const body = async (p: string) => {
  const r = await fetch(`${base}/${p}`);
  return r.ok ? r.text() : `HTTP ${r.status}`;
};

describe("species photo sizes", () => {
  it("serves each size where it exists", async () => {
    expect(await body("both.jpg?size=large")).toBe("large");
    expect(await body("both.jpg?size=card")).toBe("card");
    expect(await body("both.jpg")).toBe("original");
  });

  it("falls back to the large image, then the card, where the original was left out", async () => {
    expect(await body("packaged.jpg")).toBe("large");
    expect(await body("packaged.jpg?size=large")).toBe("large");
    expect(await body("cardonly.jpg?size=large")).toBe("card");
    expect(await body("cardonly.jpg")).toBe("card");
    expect(await body("missing.jpg?size=large")).toBe("HTTP 404");
  });
});
