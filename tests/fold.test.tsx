// @vitest-environment jsdom
/**
 * The fold primitive (WEBUI-REDESIGN 2.5 / 4.1): opens by default, folds on click, remembers the
 * state per key in localStorage, shows its summary only while folded, keeps its aside controls
 * outside the toggle.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FoldPanel } from "../src/client/ui/Fold";

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

function mount(defaultOpen?: boolean) {
  act(() => {
    root!.render(
      <FoldPanel foldKey="t" title="Panel" summary="a summary" aside={<button type="button">aside</button>} defaultOpen={defaultOpen}>
        <p>content</p>
      </FoldPanel>,
    );
  });
}

describe("FoldPanel", () => {
  it("is open by default and folds on the toggle, remembering the choice", () => {
    mount();
    const section = host.querySelector(".fold")!;
    expect(section.classList.contains("fold--closed")).toBe(false);
    expect(host.querySelector(".fold-toggle")?.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      (host.querySelector(".fold-toggle") as HTMLButtonElement).click();
    });
    expect(section.classList.contains("fold--closed")).toBe(true);
    expect(host.querySelector(".fold-body")?.getAttribute("aria-hidden")).toBe("true");
    expect(window.localStorage.getItem("edexo.fold.t")).toBe("0");
    expect(host.querySelector(".fold-summary")?.textContent).toBe("a summary");
  });

  it("starts folded when the memory says so", () => {
    window.localStorage.setItem("edexo.fold.t", "0");
    mount();
    expect(host.querySelector(".fold")?.classList.contains("fold--closed")).toBe(true);
    act(() => {
      (host.querySelector(".fold-toggle") as HTMLButtonElement).click();
    });
    expect(host.querySelector(".fold")?.classList.contains("fold--closed")).toBe(false);
    expect(window.localStorage.getItem("edexo.fold.t")).toBe("1");
  });

  it("keeps the aside out of the toggle button", () => {
    mount();
    const aside = host.querySelector(".fold-aside button")!;
    expect(aside.closest(".fold-toggle")).toBeNull();
    act(() => {
      (aside as HTMLButtonElement).click();
    });
    expect(host.querySelector(".fold")?.classList.contains("fold--closed")).toBe(false);
  });
});
