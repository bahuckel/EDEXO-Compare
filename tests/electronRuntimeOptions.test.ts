/**
 * Where the desktop app listens, given its launch mode and the flags after the exe.
 *
 * The port was hard-coded at 7111 and `--port` was dropped on the floor — so a second instance
 * could not be started beside a running one, which is the first thing anyone tries, and the flag
 * looked accepted because nothing complained. Found by launching the packaged build and watching it
 * bind 7111 after being asked for 7118.
 */
import { describe, expect, it } from "vitest";
import { electronRuntimeOptions } from "../src/server/edexoBootstrap.js";

const exe = ["C:\app\EDExoCompare.exe"];

describe("the port", () => {
  it("is taken from --port, which is the whole point of this file", () => {
    expect(electronRuntimeOptions("server", [...exe, "--port", "7118"]).port).toBe(7118);
    expect(electronRuntimeOptions("client", [...exe, "--local", "--port", "7118"]).port).toBe(7118);
  });

  it("stays 7111 when nothing says otherwise", () => {
    expect(electronRuntimeOptions("server", exe).port).toBe(7111);
  });

  it("ignores a port that is not a number rather than binding NaN", () => {
    expect(electronRuntimeOptions("server", [...exe, "--port", "wibble"]).port).toBe(7111);
  });
});

describe("the address", () => {
  it("follows the launch mode, because that is what --local and --client mean to the shell", () => {
    expect(electronRuntimeOptions("server", exe).bindHost).toBe("0.0.0.0");
    expect(electronRuntimeOptions("client", exe).bindHost).toBe("127.0.0.1");
  });

  it("does not let an absent --host put a client-mode window on the network", () => {
    /*
      THE ONE THAT MATTERS. `parseHost` answers 0.0.0.0 for an argv with no host flag at all, so
      calling it unconditionally would quietly publish a loopback-only launch to the LAN — the exact
      direction this must never fail in.
    */
    expect(electronRuntimeOptions("client", [...exe, "--local"]).bindHost).toBe("127.0.0.1");
  });

  it("honours --host and --lan when they are actually there", () => {
    expect(electronRuntimeOptions("client", [...exe, "--host", "192.168.1.9"]).bindHost).toBe("192.168.1.9");
    expect(electronRuntimeOptions("client", [...exe, "--lan"]).bindHost).toBe("0.0.0.0");
  });
});
