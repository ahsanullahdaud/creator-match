import type { CacheStore } from "@/lib/cache";
import { CacheUnavailableError } from "@/lib/errors";

/**
 * Shapes for vi.mock("@google/genai"). Call geminiModuleMock inside the mock
 * factory so the fake classes are created in the mocked module scope:
 *
 *   const gemini = vi.hoisted(() => ({ create: vi.fn(), constructed: [] as unknown[] }));
 *   vi.mock("@google/genai", async () => {
 *     const { geminiModuleMock } = await import("@/test/mocks");
 *     return geminiModuleMock(gemini);
 *   });
 */

export interface GeminiMockState {
  create: (...args: unknown[]) => unknown;
  constructed?: unknown[];
}

export function geminiModuleMock(state: GeminiMockState) {
  class ApiError extends Error {
    status: number;
    constructor(info: { message: string; status: number }) {
      super(info.message);
      this.name = "ApiError";
      this.status = info.status;
    }
  }

  class GoogleGenAI {
    interactions: { create: (...args: unknown[]) => unknown };
    constructor(options: unknown) {
      state.constructed?.push(options);
      this.interactions = { create: (...args) => state.create(...args) };
    }
  }

  return { GoogleGenAI, ApiError };
}

/** A completed interaction whose text is `text`. */
export function interactionWith(text: string, status = "completed") {
  return {
    id: "int_test",
    status,
    output_text: text,
    usage: { total_input_tokens: 120, total_output_tokens: 60 },
  };
}

const DEAD = () => new Error("connect ECONNREFUSED 127.0.0.1:6379");

/**
 * A store that behaves like a dead Redis: every operation throws
 * CacheUnavailableError, except reads of the keys handed to the constructor.
 */
export class FailingStore implements CacheStore {
  readonly kind = "redis" as const;

  constructor(private readonly reads: Record<string, unknown> = {}) {}

  async get<T>(key: string): Promise<T | null> {
    if (key in this.reads) return this.reads[key] as T;
    throw new CacheUnavailableError("get", DEAD());
  }

  async set(): Promise<void> {
    throw new CacheUnavailableError("set", DEAD());
  }

  async incr(): Promise<number> {
    throw new CacheUnavailableError("incr", DEAD());
  }

  async del(): Promise<void> {
    throw new CacheUnavailableError("del", DEAD());
  }
}
