import { describe, expect, it } from "vitest";
import { ndjsonResponse, readNdjson } from "@/lib/ndjson";

async function* three() {
  yield { n: 1 };
  yield { n: 2, text: "two\nlines" };
  yield { n: 3 };
}

describe("ndjsonResponse and readNdjson", () => {
  it("round-trips objects one per line with streaming headers", async () => {
    const res = ndjsonResponse(three());
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const seen: unknown[] = [];
    const count = await readNdjson(res, (line) => seen.push(line));
    expect(count).toBe(3);
    expect(seen).toEqual([{ n: 1 }, { n: 2, text: "two\nlines" }, { n: 3 }]);
  });

  it("handles lines split across chunks and a missing final newline", async () => {
    const encoder = new TextEncoder();
    const chunks = ['{"a":1}\n{"b"', ":2}\n", '{"c":3}'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const seen: unknown[] = [];
    await readNdjson(new Response(body), (line) => seen.push(line));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("falls back to text() when there is no body stream", async () => {
    const res = new Response('{"x":1}\n\n{"x":2}\n');
    Object.defineProperty(res, "body", { value: null });
    const seen: unknown[] = [];
    expect(await readNdjson(res, (line) => seen.push(line))).toBe(2);
    expect(seen).toEqual([{ x: 1 }, { x: 2 }]);
  });
});
