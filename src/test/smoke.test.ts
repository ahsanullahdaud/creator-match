import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("toolchain", () => {
  it("runs a test and resolves zod", () => {
    const Schema = z.object({ ok: z.boolean() });
    expect(Schema.parse({ ok: true })).toEqual({ ok: true });
  });
});
