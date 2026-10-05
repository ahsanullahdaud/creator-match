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
