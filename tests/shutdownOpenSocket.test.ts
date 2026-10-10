/**
 * Closing the server with a WebSocket still open (a phone, a browser tab) returns at once (code review
 * 2026-10-10, A2); the desktop app used to wait its eight seconds and then end the server's process.
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import type { AppSnapshot } from "../src/shared/types.js";

describe("shutdown with an open socket", () => {
  it("closes in well under a second", async () => {
    const { server, listening, closeConnections } = createHttpServer({
      port: 0,
      bindHost: "127.0.0.1",
      getSnapshot: () => ({ n: 1 }) as unknown as AppSnapshot,
      getStatus: () => ({ ok: true }) as never,
      getCommanderPosition: () => null,
      getCommanderSystem: () => null,
    });
    await listening;
    const port = (server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    const t0 = Date.now();
    closeConnections();
    await new Promise<void>((res) => server.close(() => res()));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
