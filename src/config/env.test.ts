import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const live = { ENGINEX_BASE_URL: "https://enginex.example.com", ENGINEX_API_KEY: "ek_test_x" };

describe("parseEnv", () => {
  it("applies defaults", () => {
    const e = parseEnv(live);
    expect(e.AUTH_MODE).toBe("anonymous");
    expect(e.ENGINEX_MODE).toBe("live");
    expect(e.PAYMENTS_ENABLED).toBe(false);
    expect(e.ADMIN_EMAILS).toEqual([]);
  });

  it("requires Engine X credentials in live mode", () => {
    expect(() => parseEnv({})).toThrow(/ENGINEX_BASE_URL and ENGINEX_API_KEY/);
    expect(parseEnv({ ENGINEX_MODE: "mock" }).ENGINEX_MODE).toBe("mock");
  });

  it("normalises ADMIN_EMAILS", () => {
    expect(parseEnv({ ...live, ADMIN_EMAILS: " A@x.com, b@y.com ,," }).ADMIN_EMAILS).toEqual(["a@x.com", "b@y.com"]);
  });

  it("never echoes secret values in errors", () => {
    try {
      parseEnv({ ENGINEX_API_KEY: "ek_live_supersecret", ENGINEX_BASE_URL: "not a url" });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain("ek_live_supersecret");
    }
  });

  it("requires an auth secret in production", () => {
    expect(() => parseEnv({ ...live, NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
