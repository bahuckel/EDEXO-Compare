/**
 * @vitest-environment jsdom
 *
 * The copy-system-name icon (owner, 2026-09-25): an icon right after the name, a tick with a
 * "Copied" tooltip once the clipboard took it, nothing at all when there is no name to copy, and a
 * click that never doubles as a click on the row underneath.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { CopySystemButton } from "../src/client/CopySystemButton";

let host: HTMLDivElement;
let root: Root;
const writeText = vi.fn(async () => {});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("CopySystemButton", () => {
  it("copies the name, turns into a tick titled Copied, and does not click the row", async () => {
    const rowClick = vi.fn();
    act(() =>
      root.render(
        <div onClick={rowClick}>
          <CopySystemButton system="Tegnae HT-Z d13-1" />
        </div>,
      ),
    );
    const btn = host.querySelector("button.sys-copy") as HTMLButtonElement;
    expect(btn.title).toBe('Copy "Tegnae HT-Z d13-1"');
    await act(async () => {
      btn.click();
    });
    expect(writeText).toHaveBeenCalledWith("Tegnae HT-Z d13-1");
    expect(rowClick).not.toHaveBeenCalled();
    expect(btn.title).toBe("Copied");
    expect(btn.classList.contains("is-done")).toBe(true);
  });

  it("renders nothing without a name", () => {
    act(() =>
      root.render(
        <>
          <CopySystemButton system="" />
          <CopySystemButton system="—" />
          <CopySystemButton system={null} />
        </>,
      ),
    );
    expect(host.querySelector("button")).toBeNull();
  });
});
