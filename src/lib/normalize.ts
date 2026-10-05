import type { Brief } from "./schemas";

/** Lower-case, trimmed, single-spaced. Used wherever text feeds a cache key. Safe for the browser. */
export function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when two briefs would get the same briefId. Mirrors the server-side normalization. */
export function sameBrief(a: Brief, b: Brief): boolean {
  return (Object.keys(a) as Array<keyof Brief>).every(
    (key) => normalizeText(String(a[key])) === normalizeText(String(b[key])),
  );
}
