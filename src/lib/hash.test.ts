import { describe, expect, it } from "vitest";
import {
  briefId,
  canonicalJson,
  ipHash,
  normalizeText,
  pacificDate,
  queryHash,
  sha256Hex,
  utcDate,
} from "@/lib/hash";
import { Brief } from "@/lib/schemas";
import { briefFixture } from "@/test/fixtures";

describe("canonicalJson", () => {
  it("sorts keys at every level and leaves arrays in order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe(
      '{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("normalizeText", () => {
  it("lower-cases, trims and collapses whitespace", () => {
    expect(normalizeText("  Peak   FUEL\n mix ")).toBe("peak fuel mix");
  });
});

describe("briefId", () => {
  it("is 16 hex chars and ignores key order, spacing and casing", () => {
    const a = briefId(
      Brief.parse({
        brandName: "Peak Fuel",
        product: "Electrolyte mix for runners",
        audience: "Marathon runners",
      }),
    );
    const b = briefId(
      Brief.parse({
        audience: "  marathon   RUNNERS ",
        product: "electrolyte mix for runners",
        brandName: "peak fuel",
      }),
    );
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it("changes when any field changes", () => {
    const base = briefId(briefFixture);
    expect(briefId({ ...briefFixture, region: "GB" })).not.toBe(base);
    expect(
      briefId({ ...briefFixture, notes: "prefers short videos" }),
    ).not.toBe(base);
  });
});

describe("ipHash and queryHash", () => {
  it("ipHash depends on both ip and salt", () => {
    const a = ipHash("203.0.113.5", "salt-a");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(ipHash("203.0.113.5", "salt-b")).not.toBe(a);
    expect(ipHash("203.0.113.6", "salt-a")).not.toBe(a);
    expect(ipHash(" 203.0.113.5 ", "salt-a")).toBe(a);
  });

  it("queryHash normalizes the query but keeps region and language distinct", () => {
    const a = queryHash("Marathon  Training", "US", "en");
    expect(queryHash("marathon training", "US", "en")).toBe(a);
    expect(queryHash("marathon training", "GB", "en")).not.toBe(a);
    expect(queryHash("marathon training", "US", "es")).not.toBe(a);
  });

  it("sha256Hex matches a known digest", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("dates", () => {
  it("pacificDate rolls over at midnight Pacific, not UTC", () => {
    // PDT is UTC-7 in July
    expect(pacificDate(new Date("2026-07-01T06:59:00Z"))).toBe("2026-06-30");
    expect(pacificDate(new Date("2026-07-01T07:00:00Z"))).toBe("2026-07-01");
    // PST is UTC-8 in January
    expect(pacificDate(new Date("2026-01-01T07:59:00Z"))).toBe("2025-12-31");
    expect(pacificDate(new Date("2026-01-01T08:00:00Z"))).toBe("2026-01-01");
  });

  it("utcDate is the ISO date", () => {
    expect(utcDate(new Date("2026-10-02T23:59:59Z"))).toBe("2026-10-02");
  });
});
