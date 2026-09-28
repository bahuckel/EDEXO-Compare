import path from "node:path";
import { gzip as gzipCb } from "node:zlib";
import express from "express";

/** Below this, framing and CPU cost more than the bytes saved. */
export const GZIP_MIN_BYTES = 8192;

/**
 * Send an already-serialized JSON body, gzipped when the client accepts it.
 *
 * The snapshot is ~630 KB of highly repetitive JSON and compresses ~85%. Compression runs on the
 * zlib threadpool, not the event loop, so a poll no longer costs the main thread anything beyond
 * the serialize it already did. `onSent` reports both sizes for the perf log.
 */
export function sendJson(
  req: express.Request,
  res: express.Response,
  body: string,
  onSent?: (rawBytes: number, sentBytes: number) => void,
): void {
  const raw = Buffer.from(body, "utf8");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Vary", "Accept-Encoding");
  const acceptsGzip = String(req.headers["accept-encoding"] ?? "").includes("gzip");
  if (!acceptsGzip || raw.length < GZIP_MIN_BYTES) {
    onSent?.(raw.length, raw.length);
    res.end(raw);
    return;
  }
  gzipCb(raw, { level: 6 }, (err, gz) => {
    if (err || res.writableEnded) {
      onSent?.(raw.length, raw.length);
      if (!res.writableEnded) res.end(raw);
      return;
    }
    res.setHeader("Content-Encoding", "gzip");
    onSent?.(raw.length, gz.length);
    res.end(gz);
  });
}

export function assertInsideDir(dir: string, candidate: string): boolean {
  const base = path.resolve(dir);
  const abs = path.resolve(candidate);
  const rel = path.relative(base, abs);
  return (rel === "" || !rel.startsWith("..")) && !path.isAbsolute(rel);
}
