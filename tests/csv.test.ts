/** CSV export (review F-5.11). */
import { describe, expect, it } from "vitest";
import { csvFileName, toCsv } from "../src/client/csv";

describe("toCsv", () => {
  it("quotes what needs it, leaves blanks for missing values, and starts with a BOM", () => {
    const rows = [
      { name: 'Sol "home"', n: 1.5, region: null },
      { name: "Colonia, the far one", n: Number.NaN, region: "Inner Orion Spur" },
      { name: "Œdipus\nline", n: 0, region: " padded" },
    ];
    const csv = toCsv(rows, [
      { label: "System", value: (r) => r.name },
      { label: "Value", value: (r) => r.n },
      { label: "Region", value: (r) => r.region },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "System,Value,Region",
      '"Sol ""home""",1.5,',
      '"Colonia, the far one",,Inner Orion Spur',
      '"Œdipus\nline",0," padded"',
      "",
    ]);
  });

  it("names the file after what it holds and the day", () => {
    expect(csvFileName("My discoveries: Bodies", new Date("2026-10-02T20:00:00Z"))).toBe(
      "edexo-my-discoveries-bodies-2026-10-02.csv",
    );
  });
});
