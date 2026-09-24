// @vitest-environment jsdom
/**
 * The "Send to EDDN" box in Options: off unless the snapshot says on, the name line visible without
 * opening the `?`, and the checkbox posting to its own setting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EddnUploadPanel } from "../src/client/OptionsModal";

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root?.unmount();
  root = createRoot(host);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(state: { enabled: boolean; sent: number; failed: number }) {
  act(() => {
    root!.render(<EddnUploadPanel state={state} />);
  });
}

describe("Send to EDDN panel", () => {
  it("shows off, and says the name is sent and scrambled, before anything is switched", () => {
    mount({ enabled: false, sent: 0, failed: 0 });
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(host.textContent).toContain("Send to EDDN");
    expect(host.textContent).toContain("Your CMDR name is sent to EDDN");
    expect(host.textContent).not.toContain("This session");
  });

  it("posts the switch to its own setting", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    mount({ enabled: false, sent: 0, failed: 0 });
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
      // Let the request settle inside act, so the busy flag clears where React expects it.
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings/eddn-upload");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
  });

  it("shows the session tally once something has gone", () => {
    mount({ enabled: true, sent: 12, failed: 1 });
    expect(host.textContent).toContain("This session: 12 sent, 1 not accepted.");
  });
});
