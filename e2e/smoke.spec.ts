import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The main views, each loaded once against the fixture journal, screenshotted, and checked for
 * uncaught page errors. Not a pixel test: the pictures are for a human, the assertions are the
 * cheap ones that catch a broken bundle or a missing section.
 */
const OUT = "build-artifacts/webui-preview";
mkdirSync(OUT, { recursive: true });

function watchErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/*
  The galaxy map needs data/galaxy/bio-index.bin (245 MB, built from EDAstro's export and not in the
  repository), so a fresh clone skips its tests instead of failing them (review F-F12).
*/
const HAS_GALAXY_INDEX = existsSync(path.join("data", "galaxy", "bio-index.bin"));
// Playwright requires the fixtures argument to be destructured, even when none is used.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, info) => {
  test.skip(info.title.startsWith("galaxy 3D") && !HAS_GALAXY_INDEX, "no data/galaxy/bio-index.bin on this clone");
});

test.beforeAll(async ({ request }) => {
  // Vite is up when the web server check passes; the API behind the proxy takes a moment longer.
  await expect
    .poll(async () => (await request.get("/api/state?channel=launcher")).status(), { timeout: 90_000 })
    .toBe(200);
});

test("app: the fixture body appears with its candidate species", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  // The fixture, not a live game: its system name is on screen and its one bio body is the only tab.
  await expect(page.getByText("Smoke Test", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".species-card").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/app-body.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("app: the Privacy Policy and Terms open from the footer, served by the app itself", async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  for (const [name, h1] of [
    ["Privacy Policy", "Privacy Policy"],
    ["Terms of Service", "Terms of Service"],
  ] as const) {
    const link = page.locator(".app-legal-footer-links a", { hasText: name });
    await expect(link).toHaveAttribute("href", /^\/legal\/(privacy|terms)\.html$/);
    const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await expect(tab.locator("h1")).toHaveText(h1);
    await expect(tab.locator("link[rel=stylesheet]")).toHaveCount(1);
    await tab.close();
  }
  expect(errors).toEqual([]);
});

test("launcher: renders with the live strip", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/launcher.html");
  await expect(page.getByText("Open exobiology UI")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/launcher.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("launcher: the HUD menu warns when Elite is set to fullscreen", async ({ page }) => {
  /*
    The warning has to be *rendered*, not merely computed. An always-on-top window cannot draw over
    an exclusive fullscreen game, and this line is the only place the app ever says so — shipped
    invisible it would be worth nothing, which is the failure mode this repo keeps meeting.

    The fixture Options tree says Fullscreen; the server reads that file on every request.
  */
  const errors = watchErrors(page);
  await page.goto("/launcher.html");
  /*
    `dispatchEvent` rather than `click`: the cockpit buttons carry a running glow animation, so
    Playwright's "stable" check never settles and a plain click waits for a keyframe that never
    comes; and `force` still hit-tests, so the event landed on whatever sits over the button and the
    modal never opened. Dispatching on the element runs the handler the commander's click runs.
  */
  await page.locator("#btnOverlayMenu").dispatchEvent("click");
  await expect(page.locator("#overlayPickModal")).toHaveClass(/on/);
  const warn = page.locator("#hudDisplayWarn");
  await expect(warn).toBeVisible();
  await expect(warn).toContainText("Borderless");
  // Shot of the panel it lives in, not the whole page: on a first run the setup card sits over the
  // modal, and a full-page capture says nothing about how the line itself reads.
  await warn.scrollIntoViewIfNeeded();
  await page
    .locator("#overlayPickModal .modal")
    .first()
    .screenshot({ path: `${OUT}/launcher-display-warning.png` });
  expect(errors).toEqual([]);
});

/*
  Show / Hide every HUD from the launcher (owner, 2026-09-28). A browser has no Electron, so the
  bridge is faked: the modal must read the saved state, the buttons must ask for the right one, and
  a change made elsewhere (the hotkey, the tray) must reach the buttons.
*/
test("launcher: the HUDs' Show / Hide switch follows the saved state and the hotkey", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const state = {
      hidden: true,
      count: 2,
      calls: [] as unknown[],
      push: null as null | ((v: unknown) => void),
    };
    w.__hudVis = state;
    w.edexoElectron = {
      getHudLayout: async () => ({ corner: "tr", order: [], hidden: state.hidden, count: state.count }),
      setHudLayout: async () => ({}),
      toggleHudVisibility: async (o: { hidden: boolean }) => {
        state.calls.push(o);
        state.hidden = o.hidden;
        return { hidden: state.hidden };
      },
      onHudVisibility: (cb: (v: unknown) => void) => {
        state.push = cb;
      },
    };
  });
  await page.goto("/launcher.html");
  await page.locator("#btnOverlayMenu").dispatchEvent("click");
  await expect(page.locator("#overlayPickModal")).toHaveClass(/on/);
  const show = page.locator("#hudVisShow");
  const hide = page.locator("#hudVisHide");
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#hudVisSummary")).toHaveText("HUDs are hidden (2 open)");

  await show.dispatchEvent("click");
  await expect(show).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() => (window as unknown as { __hudVis: { calls: unknown[] } }).__hudVis.calls),
  ).toEqual([{ hidden: false }]);

  // The hotkey pressed in game: Electron tells the launcher.
  await page.evaluate(() =>
    (window as unknown as { __hudVis: { push: (v: unknown) => void } }).__hudVis.push({
      hidden: true,
      count: 2,
    }),
  );
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await page
    .locator("#overlayPickModal .modal")
    .first()
    .screenshot({ path: `${OUT}/launcher-hud-visibility.png` });
  expect(errors).toEqual([]);
});

/*
  Linux setup card and the tray option (owner, 2026-09-28). This machine is not Linux, so the check's
  answer is faked at the network layer, and the Electron bridge in the page.
*/
test("launcher: the Linux setup card lists what is missing, and the tray option greys out", async ({
  page,
}) => {
  const errors = watchErrors(page);
  let items = [
    {
      id: "compositor",
      severity: "warning",
      title: "No compositor running",
      detail: "Without a compositor the HUD cannot be see-through.",
      packages: ["picom"],
      command: "sudo pacman -S --needed picom",
      then: "Start it with `picom -b`.",
    },
    {
      id: "xwayland",
      severity: "blocker",
      title: "XWayland is not available",
      detail: "The HUDs cannot be positioned or kept on top.",
      packages: ["xorg-xwayland"],
      command: "sudo pacman -S --needed xorg-xwayland",
    },
  ];
  await page.route("**/api/system/linux-check", (route) =>
    route.fulfill({
      json: {
        applicable: true,
        distro: { id: "cachyos", name: "CachyOS", version: null, family: "arch" },
        session: "wayland",
        desktop: "Hyprland",
        items,
      },
    }),
  );
  await page.addInitScript(() => {
    // Past the first-run card, which would otherwise come first and hold this one back.
    localStorage.setItem("edexo.launcher.wizardDone", "1");
    (window as unknown as Record<string, unknown>).edexoElectron = {
      getTrayPref: async () => ({
        enabled: true,
        available: false,
        reason: "Your desktop shows no tray icons (GNOME needs the AppIndicator extension).",
      }),
      setTrayPref: async () => ({ enabled: true, available: false }),
      getHotkeyStatus: async () => ({ shortcut: "Control+Alt+H", registered: false }),
    };
  });
  await page.goto("/launcher.html");
  const modal = page.locator("#linuxSetupModal");
  await expect(modal).toHaveClass(/on/);
  await expect(page.locator("#linuxSetupIntro")).toContainText("CachyOS · wayland · Hyprland — 3 things");
  await expect(page.locator("#linuxSetupList li")).toHaveCount(3);
  await expect(page.locator("#linuxSetupList li.blocker code")).toHaveText(
    "sudo pacman -S --needed xorg-xwayland",
  );
  await expect(page.locator("#linuxSetupList li").nth(2)).toContainText("Control+Alt+H is taken");

  const tray = page.locator("#trayPrefRow");
  await expect(tray).toBeVisible();
  await expect(page.locator("#trayPref")).toBeDisabled();
  await expect(tray).toHaveAttribute("title", /AppIndicator/);
  await page.locator("#linuxSetupList").screenshot({ path: `${OUT}/launcher-linux-setup.png` });

  // Closed: remembered for this set of problems...
  await page.locator("#linuxSetupClose").dispatchEvent("click");
  await expect(modal).not.toHaveClass(/on/);
  await page.reload();
  await page.waitForTimeout(800);
  await expect(modal).not.toHaveClass(/on/);
  // ...and shown again when a new one appears.
  items = [...items, { ...items[0]!, id: "tray", title: "GNOME has no tray", command: "x" }];
  await page.reload();
  await expect(modal).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

/*
  A Proton journal path is one unbroken word far wider than the launcher. On the first Linux run
  (Ubuntu, 2026-09-28) it pushed the first-run card sideways and gave the window a scrollbar.
*/
test("launcher: a long Proton journal path wraps inside the first-run card", async ({ page }) => {
  const errors = watchErrors(page);
  const longDir =
    "/home/commander/.local/share/Steam/steamapps/compatdata/359320/pfx/drive_c/users/steamuser/Saved Games/Frontier Developments/Elite Dangerous";
  await page.setViewportSize({ width: 548, height: 768 });
  await page.goto("/launcher.html");
  await expect(page.locator("#wizardModal")).toHaveClass(/on/);
  // The state arrives over the socket; the card is what is under test, so the path goes straight in.
  await expect(page.locator("#wzJournalDir")).not.toBeEmpty();
  await page.locator("#wzJournalDir").evaluate((el, d) => (el.textContent = d), longDir);
  const overflow = await page.evaluate(() =>
    [document.scrollingElement!, document.getElementById("wizardModal")!, ...document.querySelectorAll("#wizardModal .modal")]
      .map((el) => el.scrollWidth - el.clientWidth)
      .filter((d) => d > 0),
  );
  expect(overflow).toEqual([]);
  await page.locator("#wizardModal .modal").first().screenshot({ path: `${OUT}/launcher-wizard-long-path.png` });
  expect(errors).toEqual([]);
});

test("hud: the merged overlay shows every section", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("/hud-overlay.html?s=jump,fss,candidates,distance,datavalue");
  await expect(page.locator(".hud-section")).toHaveCount(5);
  await expect(page.locator('[data-section="fss"] [data-f="status"]')).not.toHaveText("Standby", {
    timeout: 30_000,
  });
  await page.screenshot({ path: `${OUT}/hud-merged.png`, fullPage: true });
  expect(errors).toEqual([]);
});

/*
  The 3D galaxy map (G1, docs/galaxy-plan-28092026.md): the whole index loads, region names are
  placed, and moving close to Sol swaps the overview for precise tiles there.
*/
test("galaxy 3D: loads every system, names the regions, fetches close-up tiles near Sol", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto("/?screen=galaxy");
  type G = { stats: () => { phase: string; overviewPoints: number; tilesLoaded: number } };
  const stats = () => page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.stats());
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __galaxy?: G }).__galaxy?.stats().phase), {
      timeout: 60_000,
    })
    .toBe("ready");
  expect((await stats()).overviewPoints).toBeGreaterThan(1_000_000);
  await expect(page.locator(".g3d-label").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("g3d-status")).toContainText("systems");
  await page.screenshot({ path: `${OUT}/galaxy-3d-top.png` });

  await page.evaluate(() =>
    (window as unknown as { __galaxy: { lookAt: (x: number, y: number, z: number, d: number) => void } }).__galaxy.lookAt(
      0,
      0,
      0,
      2500,
    ),
  );
  await expect.poll(async () => (await stats()).tilesLoaded, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("g3d-status")).toContainText("close-up");
  await page.screenshot({ path: `${OUT}/galaxy-3d-sol.png` });
  expect(errors).toEqual([]);
});

/*
  The Filter drawer (owner, 2026-10-04): tick a genus and the systems that have it light up; the Stars
  & bodies tab narrows further, any tick inside a group, every group that has one.
*/
test("galaxy 3D: the Filter drawer lights the systems that have what was ticked", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto("/?screen=galaxy");
  type G = { stats: () => { phase: string } };
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __galaxy?: G }).__galaxy?.stats().phase), {
      timeout: 60_000,
    })
    .toBe("ready");
  await page.getByRole("button", { name: /^Filter/ }).click();
  const drawer = page.getByTestId("g3d-filter");
  await drawer.getByLabel("Search the filters").fill("stratum");
  await drawer.getByLabel("Stratum, every species").check();
  const summary = drawer.locator(".g3d-filter__summary");
  await expect(summary).toContainText(/\d systems match/, { timeout: 30_000 });
  // Any thousands separator the locale uses (\s takes the no-break spaces too).
  const count = async () =>
    Number(((await summary.textContent()) ?? "").match(/([\d\s,.]+) systems match/)?.[1]?.replace(/\D/g, ""));
  const stratum = await count();
  expect(stratum).toBeGreaterThan(1000);
  await expect(page.getByRole("button", { name: "Filter (1)" })).toBeVisible();
  if (existsSync(path.join("data", "galaxy", "system-traits.bin.gz"))) {
    await drawer.getByRole("tab", { name: "Stars & bodies" }).click();
    await drawer.getByLabel("Search the filters").fill("neutron");
    await drawer.locator("fieldset", { hasText: "Any star in the system" }).getByLabel("Neutron star").check();
    await expect.poll(count, { timeout: 30_000 }).toBeLessThan(stratum);
    await page.screenshot({ path: `${OUT}/galaxy-3d-filter.png` });
    /*
      Owner, 2026-10-04: removed the plant from its chip, ticked main star O, and the map still lit the
      plant's systems. The points the engine marks must follow the ticks, not the last answer.
    */
    /*
      Owner, 2026-10-04: the map kept lighting whatever was ticked first. The engine's match arrays
      were copied into the GPU buffers, so later filters never reached the screen. These read the
      geometry's own attributes: overview and close-up tiles.
    */
    type F = {
      filter: () => { mode: number; overviewMatched: number; tilesMatched: number };
      stats: () => { stride: number; tilesLoaded: number };
      lookAt: (x: number, y: number, z: number, d: number) => void;
    };
    const marks = () =>
      page.evaluate(() => {
        const g = (window as unknown as { __galaxy: F }).__galaxy;
        return { overview: g.filter().overviewMatched * g.stats().stride, tiles: g.filter().tilesMatched };
      });
    // Close-up tiles near Sol, loaded while the first filter is on.
    await page.evaluate(() => (window as unknown as { __galaxy: F }).__galaxy.lookAt(0, 0, 0, 2500));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __galaxy: F }).__galaxy.stats().tilesLoaded), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await drawer.getByRole("button", { name: /^Stratum \(all\)/ }).click();
    await drawer.getByRole("button", { name: /^Neutron star/ }).click();
    await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
    await expect.poll(async () => (await marks()).overview + (await marks()).tiles, { timeout: 10_000 }).toBe(0);
    // His steps: O first, then a plant, both removed, then another genus.
    await drawer.getByLabel("Search the filters").fill("blue-white");
    await drawer.locator("fieldset", { hasText: "Main star" }).getByLabel("O (Blue-White)").check();
    await expect(summary).toContainText(/\d systems match/, { timeout: 30_000 });
    const oStars = await count();
    await expect.poll(async () => (await marks()).overview, { timeout: 10_000 }).toBeGreaterThan(0);
    expect((await marks()).overview).toBeLessThanOrEqual(oStars + 16 * 16);
    const oTiles = (await marks()).tiles;
    await drawer.getByRole("button", { name: /^O \(Blue-White\)/ }).click();
    await drawer.getByRole("tab", { name: "Exobio" }).click();
    await drawer.getByLabel("Search the filters").fill("tussock");
    await drawer.getByLabel("Tussock, every species").check();
    await expect.poll(count, { timeout: 30_000 }).toBeGreaterThan(oStars);
    const tussock = await count();
    // The overview marks are the new answer's, not the first one's; the tiles changed with it.
    await expect.poll(async () => (await marks()).overview, { timeout: 10_000 }).toBeGreaterThan(oStars + 16 * 16);
    expect((await marks()).overview).toBeLessThanOrEqual(tussock + 16 * 16);
    expect((await marks()).tiles).not.toBe(oTiles);
  }
  await drawer.getByRole("button", { name: /^Clear/ }).click();
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
  expect(errors).toEqual([]);
});

/*
  G2: the groups and the systems answer the mouse. A ring names its group and flies into it; a system
  under the cursor gets a card, and a click opens its panel with the name from the index.
*/
test("galaxy 3D: a group ring zooms in, a clicked system opens its panel", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto("/?screen=galaxy");
  type T = { x: number; y: number; ordinal?: number } | null;
  type G = {
    stats: () => { phase: string; level: number; groups: number; distanceLy: number; tilesLoaded: number };
    targets: () => { group: T; system: T };
    lookAt: (x: number, y: number, z: number, d: number) => void;
  };
  await expect.poll(() => page.evaluate(() => (window as unknown as { __galaxy?: G }).__galaxy?.stats().phase), { timeout: 60_000 }).toBe("ready");

  await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.lookAt(0, 0, 8000, 30000));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.stats().groups), { timeout: 15_000 }).toBeGreaterThan(5);
  const ring = await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.targets().group);
  expect(ring).not.toBeNull();
  await page.mouse.move(ring!.x, ring!.y);
  await expect(page.locator(".g3d-tip")).toContainText(/zoom in/);
  await page.mouse.click(ring!.x, ring!.y);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.stats().distanceLy), { timeout: 10_000 })
    .toBeLessThan(12_000);

  // Colonia, close: systems are pickable.
  await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.lookAt(-9530, -910, 19808, 700));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.stats().tilesLoaded), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator(".g3d-label--system").first()).toBeVisible({ timeout: 15_000 });
  const sys = await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.targets().system);
  expect(sys).not.toBeNull();
  await page.mouse.move(sys!.x, sys!.y);
  await expect(page.locator(".g3d-tip")).toContainText("Click for details");
  await page.mouse.click(sys!.x, sys!.y);
  const panel = page.getByTestId("g3d-panel");
  await expect(panel.locator("h2")).not.toBeEmpty({ timeout: 10_000 });
  await expect(panel).toContainText("ly from Sol");
  await panel.screenshot({ path: `${OUT}/galaxy-3d-panel.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

/*
  G3: the commander's own systems are on the map and answer the mouse (the fixture journal has one,
  "Smoke Test", at 1200 / 60 / 4100), and the Codex mode lists regions and opens a codex dot.
*/
test("galaxy 3D: your system opens your panel; the Codex mode opens a region and a dot", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto("/?screen=galaxy");
  type M = { x: number; y: number; id: string } | null;
  type G = {
    stats: () => { phase: string };
    marker: (layer: string) => M;
    lookAt: (x: number, y: number, z: number, d: number) => void;
  };
  await expect.poll(() => page.evaluate(() => (window as unknown as { __galaxy?: G }).__galaxy?.stats().phase), { timeout: 60_000 }).toBe("ready");

  await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.lookAt(1200, 60, 4100, 1500));
  let mine: M = null;
  await expect
    .poll(async () => (mine = await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.marker("you"))), { timeout: 15_000 })
    .not.toBeNull();
  await page.mouse.move(mine!.x, mine!.y);
  await expect(page.locator(".g3d-tip")).toContainText("Smoke Test");
  await page.mouse.click(mine!.x, mine!.y);
  const panel = page.getByTestId("g3d-panel");
  await expect(panel.locator("h2")).toContainText("Smoke Test");
  await expect(panel).toContainText("Visited");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Codex" }).click();
  const codex = page.getByTestId("g3d-codex");
  await expect(codex.locator(".g3d-codex__region").first()).toBeVisible({ timeout: 15_000 });
  await codex.getByRole("button", { name: /Inner Orion Spur/ }).click();
  // Picking a region glides the camera over it (0.7 s); a dot's screen position is only final after.
  await page.waitForTimeout(1500);
  let dot: M = null;
  await expect
    .poll(async () => (dot = await page.evaluate(() => (window as unknown as { __galaxy: G }).__galaxy.marker("codex"))), { timeout: 20_000 })
    .not.toBeNull();
  await page.mouse.click(dot!.x, dot!.y);
  await expect(panel).toContainText("codex entries logged in this region");
  await page.screenshot({ path: `${OUT}/galaxy-3d-codex.png` });
  expect(errors).toEqual([]);
});

/*
  G4: what the Classic map did, in the 3D one — Find (region, sector, system), a sector ring's panel
  of its best systems, and the galaxy search with its hits on the map.
*/
test("galaxy 3D: Find, a sector's best systems, and the search on the map", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?screen=galaxy");
  type G = {
    stats: () => { phase: string; distanceLy: number };
    targets: () => { group: { x: number; y: number } | null };
    marker: (layer: string) => { x: number; y: number; id: string } | null;
    lookAt: (x: number, y: number, z: number, d: number) => void;
  };
  const G = <R,>(f: (g: G) => R) => page.evaluate(`(${f.toString()})(window.__galaxy)`) as Promise<R>;
  await expect.poll(() => page.evaluate(() => (window as unknown as { __galaxy?: G }).__galaxy?.stats().phase), { timeout: 60_000 }).toBe("ready");

  // Find: a region flies out to it; a system in a named sector flies in and opens it.
  const find = page.getByRole("searchbox", { name: "Find" });
  await find.fill("Norma");
  const list = page.getByTestId("g3d-find");
  await expect(list).toContainText("Norma Expanse");
  await list.getByRole("button", { name: /Norma Expanse/ }).click();
  await expect.poll(() => G((g) => g.stats().distanceLy), { timeout: 10_000 }).toBeGreaterThan(30_000);
  await find.fill("Eol Prou IW");
  await expect(list.getByRole("button").first()).toContainText("Eol Prou IW", { timeout: 15_000 });
  await list.getByRole("button").first().click();
  const panel = page.getByTestId("g3d-panel");
  await expect(panel.locator("h2")).toContainText("Eol Prou IW", { timeout: 10_000 });
  await page.keyboard.press("Escape");

  // A sector ring: its best systems, most valuable first.
  await G((g) => g.lookAt(0, 0, 8000, 30000));
  await page.waitForTimeout(2500);
  const ring = await G((g) => g.targets().group);
  expect(ring).not.toBeNull();
  await page.mouse.click(ring!.x, ring!.y);
  await expect(panel).toContainText("Most valuable here", { timeout: 15_000 });
  await expect(panel.locator("tbody tr").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // The galaxy search in its drawer: Stratum, one mark per sector on the map.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const drawer = page.getByTestId("g3d-search");
  await expect(drawer.locator(".gsx-go")).toBeVisible({ timeout: 60_000 });
  await drawer.locator(".gsx-field").first().locator("button").first().click();
  await page.getByRole("option", { name: /Stratum/ }).first().click();
  await drawer.locator(".gsx-go").click();
  await expect(drawer).toContainText("the map shows one per sector", { timeout: 60_000 });
  await G((g) => g.lookAt(0, 0, 20000, 90000));
  await page.waitForTimeout(1500);
  const hit = await G((g) => g.marker("search"));
  expect(hit).not.toBeNull();
  await page.mouse.move(hit!.x, hit!.y);
  await expect(page.locator(".g3d-tip")).toContainText("Search result");
  await page.screenshot({ path: `${OUT}/galaxy-3d-search.png` });
  expect(errors).toEqual([]);
});

/*
  G5: the galaxy-wide value floor and Next target — the nearest system worth at least X that the
  commander has not done, flown to and opened, and Skip moving on. The fixture ship sits at
  1200 / 60 / 4100.
*/
test("galaxy 3D: worth at least X, Next target and Skip", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto("/?screen=galaxy");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __galaxy?: { stats: () => { phase: string } } }).__galaxy?.stats().phase), { timeout: 60_000 })
    .toBe("ready");
  const worth = page.getByRole("slider", { name: "Worth at least (million CR)", exact: true });
  await worth.fill("8"); // 50 M
  // The value sits after the track in a fixed-width span (it used to shift the slider as it changed).
  await expect(page.locator(".g3d-slider", { has: worth }).locator(".g3d-slider-val")).toContainText(/^50M \(\d/);

  await page.getByRole("button", { name: "Next target" }).click();
  const banner = page.getByTestId("g3d-target");
  await expect(banner).toContainText("Next target ≥ 50M", { timeout: 60_000 });
  const first = await banner.locator("strong").innerText();
  await expect(page.getByTestId("g3d-panel").locator("h2")).toContainText(first, { timeout: 15_000 });
  await banner.getByRole("button", { name: "Skip" }).click();
  await expect(banner.locator("strong")).not.toHaveText(first, { timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/galaxy-3d-next-target.png` });
  expect(errors).toEqual([]);
});

test("galaxy 3D: the plan chains the next targets, and a skipped stop leaves it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto("/?screen=galaxy");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __galaxy?: { stats: () => { phase: string } } }).__galaxy?.stats().phase), { timeout: 60_000 })
    .toBe("ready");
  await page.getByRole("slider", { name: "Worth at least (million CR)", exact: true }).fill("8"); // 50 M
  await page.getByRole("button", { name: "Next target" }).click();
  const banner = page.getByTestId("g3d-target");
  await expect(banner).toContainText("Next target ≥ 50M", { timeout: 60_000 });
  const first = await banner.locator("strong").innerText();

  await banner.getByRole("button", { name: /^Plan/ }).click();
  const plan = page.getByTestId("g3d-plan");
  await expect(page.getByTestId("g3d-plan-total")).toContainText(/^5 stops · [\d,]+ ly · /, { timeout: 30_000 });
  const names = plan.locator(".g3d-plan__name");
  await expect(names.first()).toHaveText(first);
  const before = await names.allInnerTexts();
  expect(new Set(before).size).toBe(5);
  // Numbered on the map, and hover/click on a stop answer as a plan stop.
  await expect(page.locator(".g3d-label--plan").first()).toBeAttached();

  await plan.getByRole("button", { name: `Skip ${before[2]}` }).click();
  await expect(names.nth(2)).not.toHaveText(before[2]!, { timeout: 30_000 });
  expect(await names.allInnerTexts()).not.toContain(before[2]);
  await expect(names.first()).toHaveText(first); // the stops before it stay

  await page.getByLabel("Stops in the plan").selectOption("8");
  await expect(names).toHaveCount(8, { timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/galaxy-3d-plan.png` });

  await plan.getByRole("button", { name: "Close the plan" }).click();
  await expect(plan).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __galaxy: { marker: (l: string) => unknown } }).__galaxy.marker("plan")))
    .toBeNull();
  expect(errors).toEqual([]);
});

test("launcher: Import Spansh export lives in the Exomastery menu", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => localStorage.setItem("edexo.launcher.wizardDone", "1"));
  await page.goto("/launcher.html");
  await page.waitForTimeout(1500); // the tiles fade in
  await page.screenshot({ path: `${OUT}/launcher-no-wizard.png`, fullPage: true });
  // Its own launcher button is gone (owner, 2026-09-29) …
  await expect(page.locator(".btn#btnImportDump")).toHaveCount(0);
  // … and the menu item opens the same panel.
  await page.locator("#btnExomasteryMenu").click();
  const item = page.locator("#exomasteryMenu").getByRole("menuitem", { name: /Import Spansh export/ });
  await expect(item).toBeVisible();
  await page.locator("#exomasteryMenu").screenshot({ path: `${OUT}/launcher-exomastery-menu.png` });
  await item.click();
  await expect(page.locator("#importModal")).toHaveClass(/on/);
  await expect(page.locator("#exomasteryMenu")).toBeHidden();
  expect(errors).toEqual([]);
});

test("launcher: Backups backs up into the chosen folder and lists it for restore", async ({ page, request }) => {
  const errors = watchErrors(page);
  // Never the default (the commander's Documents): a temporary folder, set before anything runs.
  const folder = mkdtempSync(path.join(tmpdir(), "edexo-e2e-backups-"));
  try {
    await page.addInitScript(() => localStorage.setItem("edexo.launcher.wizardDone", "1"));
    // A fresh profile has no folder chosen: the tile asks for one before anything runs on its own.
    await page.goto("/launcher.html");
    await expect(page.locator("#backupSub")).toHaveText("Choose a backup folder to start automatic backups");
    await expect(page.locator("#backupSub")).toHaveClass(/backup-sub--yellow/);

    await page.locator("#btnBackups").click();
    await expect(page.locator("#backupModal")).toHaveClass(/on/);
    await expect(page.locator("#backupNeedsFolder")).toBeVisible();
    const status = async () => (await (await request.get("/api/backup/status")).json()) as { folderChosen: boolean; folder: string };
    // Another setting saved does not quietly confirm the suggested folder.
    await page.locator("#backupKeys").check();
    await expect.poll(async () => (await status()).folderChosen).toBe(false);
    await page.locator("#backupKeys").uncheck();
    // "Use this folder" confirms whatever the field holds — a one-drive PC can keep a same-drive folder.
    await page.locator("#backupFolder").fill(folder);
    await page.locator("#backupUseFolder").click();
    await expect.poll(async () => (await status()).folderChosen).toBe(true);
    expect((await status()).folder).toBe(folder);
    await expect(page.locator("#backupNeedsFolder")).toBeHidden();
    // Chosen, but in the temp folder beside the test's app data: the tile turns red without opening the panel.
    await expect(page.locator("#backupSub")).toHaveText(/Backups share a drive with the app's data/, { timeout: 30_000 });
    await expect(page.locator("#backupSub")).toHaveClass(/backup-sub--red/);
    await expect(page.locator("#backupFolder")).toHaveValue(folder);
    await expect(page.locator("#backupOnLeave")).toBeChecked();
    await expect(page.locator("#backupRestartRow")).toBeHidden(); // no restore staged in a fresh profile
    // The temp folder shares a partition with the test's app data (also in the temp folder): red.
    await expect(page.locator("#backupRisk")).toHaveClass(/backup-risk--red/, { timeout: 30_000 });
    await expect(page.locator("#backupRisk")).toContainText("Same partition as the app's data");
    await expect(page.locator("#backupRisk")).toContainText("still better than no backup");

    await page.locator("#backupNow").click();
    await expect(page.locator("#backupState")).toContainText("Last backup", { timeout: 60_000 });
    await expect(page.locator("#backupList li")).toHaveCount(1);
    await expect(page.locator("#backupList li").first()).toContainText(/All \d+ journal files/);
    const zips = readdirSync(folder).filter((f) => f.endsWith(".zip"));
    expect(zips).toHaveLength(1);
    expect(zips[0]).toMatch(/^EDExoCompare-backup-.+-\d{4}-\d{2}-\d{2}_\d{4}\.zip$/);

    // A setting saved from the panel reaches the server.
    await page.locator("#backupKeep").fill("4");
    await page.locator("#backupKeep").dispatchEvent("change");
    await expect.poll(async () => (await (await request.get("/api/backup/status")).json()).settings.keep).toBe(4);
    await page.locator("#backupModal .modal").first().screenshot({ path: `${OUT}/launcher-backups.png` });

    // Journals restored into another folder, through the panel.
    const target = path.join(folder, "restored");
    page.once("dialog", (d) => void d.accept(target));
    await page.locator("#backupList li").first().getByRole("button", { name: "Journals" }).click();
    await expect(page.locator("#backupMsg")).toContainText("journal files written", { timeout: 30_000 });
    expect(readdirSync(target).some((f) => /^Journal\..+\.log$/.test(f))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await request.post("/api/backup/settings", { data: { folder: null, keep: 10 } });
    if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
  }
});

test("phone hud: chips and the portrait layout", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hud-overlay.html?phone=1");
  await expect(page.locator(".phone-chip:not(.phone-chip--fs)")).toHaveCount(8);
  await expect(page.locator(".phone-chip--fs")).toHaveCount(1);
  await expect(page.locator("body")).toHaveClass(/phone/);
  await page.screenshot({ path: `${OUT}/hud-phone.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("triage: the second screen lists the body", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?screen=triage");
  await expect(page.locator(".second-screen")).toBeVisible();
  await expect(page.locator(".ss-row").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/triage.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("session log: opens from the cockpit menu and offers the Markdown copy", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  // Below 1700 px the cockpit buttons live behind the menu; open it first when the button is hidden.
  const sessionLog = page.getByRole("button", { name: "Session log" });
  if (!(await sessionLog.isVisible())) await page.getByRole("button", { name: "Menu" }).click();
  await sessionLog.click();
  await expect(page.locator(".modal-panel--session")).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy as Markdown|Copied/ })).toBeVisible();
  await page.waitForTimeout(500); // the modal fades in
  await page.screenshot({ path: `${OUT}/session-log.png` });
  expect(errors).toEqual([]);
});

/* ---- added 2026-10-02 (review F-6.5): the screens and today's features without e2e cover ---- */

async function openFromMenu(page: import("@playwright/test").Page, name: string) {
  const btn = page.getByRole("button", { name, exact: true });
  if (!(await btn.isVisible())) await page.getByRole("button", { name: "Menu" }).click();
  await btn.click();
}

test("options: opens on the settings, the install facts folded at the bottom with Copy diagnostics", async ({
  page,
  context,
}) => {
  const errors = watchErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await openFromMenu(page, "Options");
  const about = page.locator(".options-about");
  await expect(about).toBeVisible();
  await expect(about).not.toHaveAttribute("open", "");
  await about.locator("summary").click();
  await page.getByRole("button", { name: "Copy diagnostics" }).click();
  const box = page.locator(".options-diagnostics-text");
  await expect(box).toBeVisible();
  const text = await box.inputValue();
  expect(text).toContain("ED Exo Compare");
  expect(text).toContain("Journals:");
  // Nothing of the commander's: no LAN key, no home folder.
  expect(text).not.toMatch(/[?&]k=[^…]/);
  await page.screenshot({ path: `${OUT}/options-about.png` });
  expect(errors).toEqual([]);
});

test("notify me: Send a test notice puts one on the bell", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await openFromMenu(page, "Options");
  const fold = page.locator(".fold-toggle", { hasText: "Notify me" });
  if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
  await page.getByRole("button", { name: "Send a test notice" }).click();
  await expect(page.getByText(/Sent: look at the mail icon/)).toBeVisible();
  const items = await page.request.get("/api/state?channel=app").then((r) => r.json());
  expect(JSON.stringify(items)).toContain("Test notice");
  expect(errors).toEqual([]);
});

test("streamer view: the app with nothing to click", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/?view=stream");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-streamer", "1");
  await expect(page.locator(".appbar-actions")).toBeHidden();
  await expect(page.locator(".snapshot-btn").first()).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")!).pointerEvents)).toBe("none");
  await page.screenshot({ path: `${OUT}/streamer-view.png` });
  expect(errors).toEqual([]);
});

test("my discoveries: the bodies table exports as CSV", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await openFromMenu(page, "My discoveries");
  // It opens on the foot-scan tab, empty in the fixture; the bodies table has the fixture's bodies.
  await page.getByRole("tab", { name: "Bodies" }).click();
  const exportBtn = page.locator(".disc-export button").first();
  await expect(exportBtn).toBeVisible({ timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), exportBtn.click()]);
  expect(dl.suggestedFilename()).toMatch(/^edexo-.+\.csv$/);
  await page.screenshot({ path: `${OUT}/discoveries.png` });
  expect(errors).toEqual([]);
});

test("data value: the fleet carrier toggle takes 25 % off exploration (15 % at his own) and is saved", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Data value/ }).click();
  const toggle = page.getByLabel(/Selling at a fleet carrier/);
  await expect(toggle).toBeVisible();
  const before = await page.request.get("/api/state").then((r) => r.json());
  // Controlled by the server's answer: it ticks once the setting is saved and the state comes back.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText("· at a carrier").first()).toBeVisible();
  const after = await page.request.get("/api/state").then((r) => r.json());
  expect(after.sellAtFleetCarrier).toBe(true);
  expect(after.explorationFssValueCredits).toBe(Math.round(before.explorationFssValueCredits * 0.75));
  // His own carrier (owner, 2026-10-04): 15 %, offered only while the carrier toggle is on.
  const own = page.getByLabel(/My own carrier/);
  await own.click();
  await expect(own).toBeChecked();
  await expect(page.getByText("· at your carrier (−15 %)").first()).toBeVisible();
  const mine = await page.request.get("/api/state").then((r) => r.json());
  expect(mine.explorationFssValueCredits).toBe(Math.round(before.explorationFssValueCredits * 0.85));
  await own.click();
  await expect(own).not.toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByLabel(/My own carrier/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("system map: opens from the system card and draws the fixture body", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await page.locator(".sys-card__btn").first().click();
  await expect(page.locator(".system-map-modal, [aria-label*='System map' i]").first()).toBeVisible();
  await expect(page.locator("svg circle").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/system-map.png` });
  expect(errors).toEqual([]);
});

test("encyclopedia: opens and lists species", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await openFromMenu(page, "Encyclopedia");
  await expect(page.getByText(/Aleoida|Bacterium|Stratum/).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/encyclopedia.png` });
  expect(errors).toEqual([]);
});

test("phone: the main view at 390 px keeps the body and its species", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".species-card, .srow").first()).toBeVisible();
  // No sideways page scroll on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `${OUT}/phone-main.png`, fullPage: true });
  expect(errors).toEqual([]);
});
