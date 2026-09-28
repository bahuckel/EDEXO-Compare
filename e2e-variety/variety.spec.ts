import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The app over twelve varied systems (playwright.variety.config.ts). Each test views one system the
 * way the header search does (POST /api/ui/view-system) and checks what a commander would look for.
 */
const OUT = "build-artifacts/webui-variety";
mkdirSync(OUT, { recursive: true });

const HIP_87621 = 147882789259;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function view(request: APIRequestContext, systemAddress: number | null) {
  const r = await request.post("/api/ui/view-system", { data: { systemAddress } });
  expect(r.ok()).toBe(true);
}

async function systemByName(request: APIRequestContext, name: string): Promise<number> {
  const snap = (await (await request.get("/api/state")).json()) as {
    journalSystems?: { starSystem: string; systemAddress: number }[];
  };
  const s = snap.journalSystems?.find((x) => x.starSystem === name);
  expect(s, `${name} in the journal`).toBeTruthy();
  return s!.systemAddress;
}

test.beforeAll(async ({ request }) => {
  await expect
    .poll(async () => (await request.get("/api/state?channel=launcher")).status(), { timeout: 90_000 })
    .toBe(200);
  // The journal is replayed at start: wait for all twelve systems.
  await expect
    .poll(
      async () =>
        ((await (await request.get("/api/state")).json()) as { journalSystems?: unknown[] }).journalSystems
          ?.length ?? 0,
      {
        timeout: 90_000,
      },
    )
    .toBeGreaterThanOrEqual(12);
});

test("Ingensradices: offered on HIP 87621 2 a beside the three genera the DSS named", async ({
  page,
  request,
}) => {
  const errors = watchErrors(page);
  await view(request, HIP_87621);
  await page.goto("/");
  await expect(page.getByText("HIP 87621", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.locator(".tab", { hasText: "2 a" }).first().click();
  await expect(page.getByText("Ingensradices Unicus").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/hip87621.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("Crystalline Shards: offered on a cold body far from the arrival star", async ({ page, request }) => {
  const errors = watchErrors(page);
  await view(request, await systemByName(request, "Phrua Hypooe SU-M d8-34"));
  await page.goto("/");
  await page.locator(".tab", { hasText: "CDE 1 c" }).first().click();
  await expect(page.getByText("Crystalline Shards").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("system map: opens, and its body panel folds and unfolds", async ({ page, request }) => {
  const errors = watchErrors(page);
  await view(request, HIP_87621);
  await page.goto("/");
  await expect(page.locator(".body-pane")).toBeVisible({ timeout: 60_000 });
  await page.locator(".sys-card__btn").first().click();
  const side = page.locator(".system-map-side");
  await expect(side).toBeVisible();
  await page.locator(".system-map-side-toggle").click();
  await expect(side).toHaveClass(/system-map-side--closed/);
  await page.locator(".system-map-side-toggle").click();
  await expect(side).not.toHaveClass(/system-map-side--closed/);
  await page.screenshot({ path: `${OUT}/system-map.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("achievements: region cards, a region's sets, and the POI note with no POI data", async ({
  page,
  request,
}) => {
  const errors = watchErrors(page);
  await view(request, null);
  await page.goto("/");
  await page.locator(".appbar-menu-btn").click();
  await page.getByRole("button", { name: "Achievements" }).click();
  await expect(page.locator(".ach-card")).toHaveCount(43);
  await expect(page.locator(".ach-poi-card")).toBeVisible();
  await page.locator(".ach-card", { hasText: "Inner Orion Spur" }).click();
  await expect(page.locator(".ach-row", { hasText: "Ingensradices" }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/achievements.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("encyclopedia: lists the two species added in 1.2.x", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.locator(".appbar-menu-btn").click();
  await page.getByRole("button", { name: "Encyclopedia" }).click();
  await expect(page.getByText("Ingensradices Unicus").first()).toBeVisible();
  await expect(page.getByText("Crystalline Shards").first()).toBeVisible();
  expect(errors).toEqual([]);
});
