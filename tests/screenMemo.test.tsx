/**
 * @vitest-environment jsdom
 *
 * Fable review D11 (2026-10-10): the header re-renders on every snapshot push and mounts every open
 * screen, hidden tabs included. The screens from SharedModals are memo'd, so a push that leaves a
 * screen's props alone no longer renders it; a changed prop still does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, Suspense } from "react";

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/client/PoiModal", () => ({
  PoiModal: ({ onClose }: { onClose: () => void }) => {
    renders.count++;
    return <button onClick={onClose}>poi</button>;
  },
}));

import { PoiModal } from "../src/client/SharedModals";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  renders.count = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Parent({ push, onClose }: { push: number; onClose: () => void }) {
  return (
    <div data-push={push}>
      <Suspense fallback={null}>
        <PoiModal onClose={onClose} />
      </Suspense>
    </div>
  );
}

describe("memo'd screens (D11)", () => {
  it("skip a parent re-render with the same props, render again on a new one", async () => {
    const close = () => {};
    await act(async () => root.render(<Parent push={0} onClose={close} />));
    await act(async () => {});
    expect(host.textContent).toBe("poi");
    const first = renders.count;
    expect(first).toBeGreaterThan(0);

    for (let i = 1; i <= 5; i++) await act(async () => root.render(<Parent push={i} onClose={close} />));
    expect(renders.count).toBe(first);

    await act(async () => root.render(<Parent push={6} onClose={() => {}} />));
    expect(renders.count).toBe(first + 1);
  });
});
