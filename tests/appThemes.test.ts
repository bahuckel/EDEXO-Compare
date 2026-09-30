/**
 * The app's colour schemes (src/shared/appThemes.ts; guild tester report, 2026-09-30).
 */
import { describe, expect, it } from "vitest";
import {
  APP_THEME_PRESETS,
  DEFAULT_APP_THEME,
  coloursFromHex,
  isAppThemeChoice,
  resolveAppTheme,
  rgbToHex,
} from "../src/shared/appThemes.js";

describe("colour schemes", () => {
  it("the default is the orange the stylesheet already had", () => {
    expect(DEFAULT_APP_THEME).toMatchObject({ key: "orange", rgb: "255, 138, 31", bright: "#ffb060", deep: "#f2760f" });
    expect(rgbToHex(DEFAULT_APP_THEME.rgb)).toBe("#ff8a1f");
  });

  it("presets, a custom colour, and anything unreadable falls back to the default", () => {
    expect(resolveAppTheme({ preset: "blue" }).rgb).toBe(APP_THEME_PRESETS.find((p) => p.key === "blue")!.rgb);
    expect(resolveAppTheme({ custom: "#35d0c0", name: "Teal" })).toMatchObject({ key: "custom", rgb: "53, 208, 192" });
    expect(resolveAppTheme({ preset: "nope" }).key).toBe("orange");
    expect(resolveAppTheme(null).key).toBe("orange");
    expect(isAppThemeChoice({ custom: "red" })).toBe(false);
    expect(isAppThemeChoice({ custom: "#abcdef" })).toBe(true);
  });

  it("a custom colour gets a lighter tint and a darker shade", () => {
    const c = coloursFromHex("#000000")!;
    expect(c).toEqual({ rgb: "0, 0, 0", bright: "#737373", deep: "#000000" });
    expect(coloursFromHex("#ffffff")!.deep).toBe("#d1d1d1");
    expect(coloursFromHex("zzz")).toBeNull();
  });
});
