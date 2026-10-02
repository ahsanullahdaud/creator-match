import { createHash } from "node:crypto";
import type { Brief } from "./schemas";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** JSON with object keys sorted at every level, so equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** Lower-case, trimmed, single-spaced. Used wherever text feeds a cache key. */
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** 16 hex chars identifying a brief. Same brief, same id, regardless of casing or spacing. */
export function briefId(brief: Brief): string {
  const normalized = Object.fromEntries(
    Object.entries(brief).map(([key, value]) => [
      key,
      typeof value === "string" ? normalizeText(value) : value,
    ]),
  );
  return sha256Hex(canonicalJson(normalized)).slice(0, 16);
}

/** Salted so raw visitor IPs never land in Redis. */
export function ipHash(ip: string, salt: string): string {
  return sha256Hex(`${salt}:${ip.trim()}`).slice(0, 16);
}

/** One YouTube search is identified by its normalized query plus the region and language filters. */
export function queryHash(q: string, region: string, language: string): string {
  return sha256Hex(`${normalizeText(q)}|${region}|${language}`).slice(0, 16);
}

const pacificFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in Pacific time. YouTube quotas reset at midnight Pacific. */
export function pacificDate(now: Date = new Date()): string {
  return pacificFormatter.format(now);
}

/** YYYY-MM-DD in UTC. Used for per-visitor daily buckets. */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
