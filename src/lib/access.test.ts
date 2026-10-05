import { describe, expect, it } from "vitest";
import {
  PASSCODE_COOKIE,
  clearPasscodeCookie,
  hasBypass,
  passcodeConfigured,
  passcodeCookie,
  passcodeToken,
  readCookie,
  verifyPasscode,
} from "@/lib/access";
import { getConfig } from "@/lib/config";

const config = getConfig({
  DEMO_PASSCODE: "open-sesame",
  RATE_LIMIT_SALT: "salt",
});
const unset = getConfig({ DEMO_PASSCODE: "", RATE_LIMIT_SALT: "salt" });
const token = passcodeToken("open-sesame", "salt");

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("verifyPasscode", () => {
  it("accepts the exact passcode only, and nothing when none is configured", () => {
    expect(passcodeConfigured(config)).toBe(true);
    expect(passcodeConfigured(unset)).toBe(false);
    expect(verifyPasscode("open-sesame", config)).toBe(true);
    expect(verifyPasscode("open-sesame ", config)).toBe(false);
    expect(verifyPasscode("Open-Sesame", config)).toBe(false);
    expect(verifyPasscode("", config)).toBe(false);
    expect(verifyPasscode("open-sesame", unset)).toBe(false);
  });
});

describe("cookies", () => {
  it("readCookie finds a named cookie among several", () => {
    const r = req("http://x", { cookie: "a=1; cm_pass=abc%20d ;b=2" });
    expect(readCookie(r, "cm_pass")).toBe("abc d");
    expect(readCookie(r, "b")).toBe("2");
    expect(readCookie(r, "missing")).toBeUndefined();
    expect(readCookie(req("http://x"), "cm_pass")).toBeUndefined();
  });

  it("hasBypass requires the token for the current passcode and salt", () => {
    expect(
      hasBypass(
        req("http://x", { cookie: `${PASSCODE_COOKIE}=${token}` }),
        config,
      ),
    ).toBe(true);
    expect(
      hasBypass(
        req("http://x", { cookie: `${PASSCODE_COOKIE}=open-sesame` }),
        config,
      ),
    ).toBe(false);
    expect(
      hasBypass(
        req("http://x", { cookie: `${PASSCODE_COOKIE}=${token}` }),
        unset,
      ),
    ).toBe(false);
    const otherSalt = getConfig({
      DEMO_PASSCODE: "open-sesame",
      RATE_LIMIT_SALT: "other",
    });
    expect(
      hasBypass(
        req("http://x", { cookie: `${PASSCODE_COOKIE}=${token}` }),
        otherSalt,
      ),
    ).toBe(false);
    expect(hasBypass(req("http://x"), config)).toBe(false);
  });

  it("passcodeCookie is httpOnly, lax, 30 days, and secure only over https", () => {
    const local = passcodeCookie(
      req("http://localhost:3000/api/passcode"),
      config,
    );
    expect(local).toContain(`${PASSCODE_COOKIE}=${token}`);
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Lax");
    expect(local).toContain("Max-Age=2592000");
    expect(local).not.toContain("Secure");
    expect(local).not.toContain("open-sesame");
    const live = passcodeCookie(
      req("https://example.com/api/passcode"),
      config,
    );
    expect(live).toContain("Secure");
    const proxied = passcodeCookie(
      req("http://internal/api/passcode", { "x-forwarded-proto": "https" }),
      config,
    );
    expect(proxied).toContain("Secure");
    expect(() => passcodeCookie(req("https://example.com"), unset)).toThrow(
      /No passcode/,
    );
    expect(clearPasscodeCookie()).toContain("Max-Age=0");
  });
});
