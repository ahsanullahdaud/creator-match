import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, type Config } from "./config";
import { AppError } from "./errors";

export const PASSCODE_COOKIE = "cm_pass";
const THIRTY_DAYS = 30 * 24 * 3600;

/** What the cookie holds: an HMAC of the passcode, never the passcode itself. */
export function passcodeToken(passcode: string, salt: string): string {
  return createHmac("sha256", salt).update(passcode).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passcodeConfigured(config: Config = getConfig()): boolean {
  return Boolean(config.DEMO_PASSCODE);
}

/** Constant-time check of a submitted passcode. False when none is configured. */
export function verifyPasscode(
  candidate: string,
  config: Config = getConfig(),
): boolean {
  const expected = config.DEMO_PASSCODE;
  return Boolean(expected) && safeEqual(candidate, expected as string);
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** True when the request carries a cookie minted for the current passcode and salt. */
export function hasBypass(
  request: Request,
  config: Config = getConfig(),
): boolean {
  const value = readCookie(request, PASSCODE_COOKIE);
  if (!value || !config.DEMO_PASSCODE) return false;
  return safeEqual(
    value,
    passcodeToken(config.DEMO_PASSCODE, config.RATE_LIMIT_SALT),
  );
}

function isSecure(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

/** Set-Cookie value granting bypass for 30 days. Secure only over https, so localhost works. */
export function passcodeCookie(
  request: Request,
  config: Config = getConfig(),
): string {
  if (!config.DEMO_PASSCODE) {
    throw new AppError(
      "forbidden",
      "No passcode is configured on this deployment.",
    );
  }
  const parts = [
    `${PASSCODE_COOKIE}=${passcodeToken(config.DEMO_PASSCODE, config.RATE_LIMIT_SALT)}`,
    "Path=/",
    `Max-Age=${THIRTY_DAYS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecure(request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearPasscodeCookie(): string {
  return `${PASSCODE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
