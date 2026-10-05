import loomnotes from "../../data/examples/loomnotes.json";
import peakFuel from "../../data/examples/peak-fuel.json";
import terraCookware from "../../data/examples/terra-cookware.json";
import { keys } from "./keys";
import { Example, type Brief } from "./schemas";

/**
 * Precomputed results for the example briefs, bundled at build time. They
 * form a read-only layer in front of the cache, so an example costs nothing
 * and keeps working when every quota is spent. Regenerate with
 * `npm run precompute` after changing hashing, schemas, or prompts.
 */
const RAW: unknown[] = [peakFuel, loomnotes, terraCookware];

interface Loaded {
  list: Example[];
  byKey: Map<string, unknown>;
}

let loaded: Loaded | null = null;

function load(): Loaded {
  if (loaded) return loaded;
  const list = RAW.map((raw) => Example.parse(raw));
  const byKey = new Map<string, unknown>();
  for (const example of list) {
    byKey.set(keys.brief(example.brief.briefId), example.brief);
    byKey.set(keys.search(example.search.briefId), example.search);
    for (const score of example.scores) {
      byKey.set(keys.score(score.briefId, score.channelId), score);
    }
  }
  loaded = { list, byKey };
  return loaded;
}

/** The precomputed value for a cache key, or undefined when the key is not an example's. */
export function exampleLookup<T>(key: string): T | undefined {
  return load().byKey.get(key) as T | undefined;
}

export interface ExampleSummary {
  slug: string;
  title: string;
  blurb: string;
  brief: Brief;
  precomputedAt: string;
}

export function listExamples(): ExampleSummary[] {
  return load().list.map((example) => ({
    slug: example.slug,
    title: example.title,
    blurb: example.blurb,
    brief: example.brief.brief,
    precomputedAt: example.precomputedAt,
  }));
}
