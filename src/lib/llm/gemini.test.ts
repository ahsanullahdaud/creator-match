import { describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@google/genai", async () => {
  const { geminiModuleMock } = await import("@/test/mocks");
  return geminiModuleMock(gemini);
});

import { ApiError } from "@google/genai";
import { createGeminiProvider, toLlmError } from "@/lib/llm/gemini";
import { interactionWith } from "@/test/mocks";

const request = {
  model: "gemini-3.5-flash-lite",
  system: "sys",
  prompt: "hello",
  schema: { type: "object" },
  maxOutputTokens: 100,
  thinking: "low" as const,
  timeoutMs: 5_000,
};

describe("toLlmError", () => {
  it("classifies statuses and names", () => {
    expect(
      toLlmError(new ApiError({ message: "quota", status: 429 })),
    ).toMatchObject({ kind: "rate_limit", retryable: true, status: 429 });
    expect(
      toLlmError(new ApiError({ message: "down", status: 503 })),
    ).toMatchObject({ kind: "unavailable", retryable: true });
    expect(
      toLlmError(new ApiError({ message: "bad", status: 400 })),
    ).toMatchObject({ kind: "invalid_request", retryable: false });
    expect(toLlmError({ statusCode: 502, message: "gateway" })).toMatchObject({
      kind: "unavailable",
      status: 502,
    });
    const timeout = new Error("Request timed out");
    timeout.name = "RequestTimeoutError";
    expect(toLlmError(timeout)).toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    expect(toLlmError(new Error("socket hang up"))).toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
  });
});

describe("createGeminiProvider", () => {
  const provider = createGeminiProvider({
    apiKey: "k",
    maxRetries: 2,
    timeoutMs: 30_000,
  });

  it("returns the text and usage of a completed interaction", async () => {
    gemini.create.mockResolvedValueOnce(interactionWith('{"ok":true}'));
    const result = await provider.complete(request);
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 60 });
    const options = gemini.create.mock.calls[0][1] as Record<string, unknown>;
    expect(options.timeout).toBe(5_000);
    expect(options.retry_codes).toContain("429");
  });

  it("treats a failed interaction as blocked", async () => {
    gemini.create.mockResolvedValueOnce({
      ...interactionWith("", "failed"),
      errors: [{ code: "SAFETY", message: "Blocked by safety filters" }],
    });
    await expect(provider.complete(request)).rejects.toMatchObject({
      kind: "blocked",
      retryable: false,
      message: expect.stringMatching(/safety/i),
    });
  });

  it("treats an incomplete interaction with no text as blocked", async () => {
    gemini.create.mockResolvedValueOnce(interactionWith("   ", "incomplete"));
    await expect(provider.complete(request)).rejects.toMatchObject({
      kind: "blocked",
    });
  });

  it("wraps SDK errors", async () => {
    gemini.create.mockRejectedValueOnce(
      new ApiError({ message: "Service Unavailable", status: 503 }),
    );
    await expect(provider.complete(request)).rejects.toMatchObject({
      kind: "unavailable",
      retryable: true,
    });
  });
});
