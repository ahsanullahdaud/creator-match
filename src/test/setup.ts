import { afterEach, vi } from "vitest";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Imported lazily so this setup file does not load modules (and the real
  // SDKs they import) before the vi.mock calls of a test file take effect.
  const { resetCache } = await import("@/lib/cache");
  resetCache();
  const { resetLlm } = await import("@/lib/llm");
  resetLlm();
});
