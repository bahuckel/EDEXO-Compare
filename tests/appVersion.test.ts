/**
 * The version other people's services see (EDSM, Canonn, Spansh, EDAstro, EDDN) is the app's real
 * one. The release commit bumps `package.json` and `src/server/appVersion.ts` together; this fails
 * when it does not.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_USER_AGENT, APP_VERSION } from "../src/server/appVersion.js";
import { CANONN_CLIENT_VERSION } from "../src/server/canonnUpload.js";
import { EDASTRO_USER_AGENT } from "../src/server/edastroCarriers.js";
import { EDDN_SOFTWARE_VERSION } from "../src/server/eddnUpload.js";
import { EDSM_USER_AGENT } from "../src/server/edsmSystemHydration.js";
import { JOURNAL_UPLOAD_VERSION } from "../src/server/edsmUploadIdentity.js";

describe("the version the app gives other services", () => {
  it("is package.json's", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("is the one every outbound identity uses", () => {
    expect(APP_USER_AGENT).toContain(`/${APP_VERSION} `);
    expect(EDSM_USER_AGENT).toBe(APP_USER_AGENT);
    expect(EDASTRO_USER_AGENT).toBe(APP_USER_AGENT);
    expect(JOURNAL_UPLOAD_VERSION).toBe(APP_VERSION);
    expect(CANONN_CLIENT_VERSION).toBe(`ED-Exo-Compare-${APP_VERSION}`);
    expect(EDDN_SOFTWARE_VERSION).toBe(APP_VERSION);
  });
});
