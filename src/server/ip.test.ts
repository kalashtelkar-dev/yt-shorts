import { describe, expect, it } from "vitest";
import { clientIp } from "./ip";

const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

describe("clientIp", () => {
  it("takes the address the trusted proxy appended, not the client's claim", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2)).toBe("203.0.113.9");
  });

  it("falls back to 'unknown' when the chain is shorter than the proxy count", () => {
    expect(clientIp(h(), 1)).toBe("unknown");
    expect(clientIp(h("203.0.113.9"), 2)).toBe("unknown");
  });

  it("ignores X-Real-IP", () => {
    expect(clientIp(new Headers({ "x-real-ip": "6.6.6.6" }), 1)).toBe("unknown");
  });
});
