import { mkdirSync } from "node:fs";
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

test("phone hud: chips and the portrait layout", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hud-overlay.html?phone=1");
  await expect(page.locator(".phone-chip:not(.phone-chip--fs)")).toHaveCount(5);
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
