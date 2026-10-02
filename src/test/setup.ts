import { afterEach, vi } from "vitest";

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Imported lazily so this setup file does not load the cache module (and the
  // real Upstash client) before a test file's vi.mock of it takes effect.
  const { resetCache } = await import("@/lib/cache");
  resetCache();
});
