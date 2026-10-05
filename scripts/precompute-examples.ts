/**
 * Runs the whole pipeline for each example brief and writes the records the
 * routes would otherwise cache, so the examples work with no quota at all.
 *
 *   npm run precompute              # all examples
 *   npm run precompute -- peak-fuel # one slug
 *
 * Spends roughly 1 + 2 Gemini requests and 3 YouTube searches per brief.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCache } from "@/lib/cache";
import { getConfig } from "@/lib/config";
import { EXAMPLE_BRIEFS } from "@/lib/example-briefs";
import { briefId } from "@/lib/hash";
import { generateQueries, scoreCreators } from "@/lib/llm";
import { aggregateHits, pickCandidates, selectCreators } from "@/lib/pipeline";
import { llmRequestsToday, youtubeSearchesToday } from "@/lib/rate-limit";
import {
  Example,
  type BriefRecord,
  type ScoreRecord,
  type SearchRecord,
} from "@/lib/schemas";
import { getChannels, searchVideos } from "@/lib/youtube";

async function main(): Promise<void> {
  const config = getConfig();
  if (!config.GEMINI_API_KEY || !config.YOUTUBE_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY and YOUTUBE_API_KEY must be set (run with --env-file=.env.local)",
    );
  }
  const only = process.argv.slice(2);
  const outDir = path.join(process.cwd(), "data", "examples");
  await mkdir(outDir, { recursive: true });
  const stamp = () => new Date().toISOString();

  for (const example of EXAMPLE_BRIEFS) {
    if (only.length > 0 && !only.includes(example.slug)) continue;
    const id = briefId(example.brief);
    console.log(`[${example.slug}] brief ${id}`);

    const queries = await generateQueries(example.brief);
    const brief: BriefRecord = {
      briefId: id,
      brief: example.brief,
      queries,
      createdAt: stamp(),
    };
    console.log(`  queries: ${queries.queries.map((q) => q.q).join(" | ")}`);

    const results = await Promise.all(
      queries.queries.map((q) =>
        searchVideos(q.q, example.brief.region, example.brief.language, {
          bypass: true,
        }),
      ),
    );
    const candidates = pickCandidates(
      aggregateHits(results.map((r) => r.hits)),
    );
    const channels = await getChannels(candidates.map((c) => c.channelId));
    const creators = selectCreators(channels, candidates, example.brief);
    const search: SearchRecord = {
      briefId: id,
      creators,
      liveSearches: results.filter((r) => r.live).length,
      createdAt: stamp(),
    };
    console.log(`  creators: ${creators.length}`);

    const scores: ScoreRecord[] = [];
    for (let i = 0; i < creators.length; i += config.LLM_SCORE_BATCH_SIZE) {
      const batch = creators.slice(i, i + config.LLM_SCORE_BATCH_SIZE);
      const map = await scoreCreators(example.brief, queries, batch);
      for (const creator of batch) {
        const score = map.get(creator.channelId);
        if (!score) {
          console.warn(`  skipped ${creator.channelId} (${creator.title})`);
          continue;
        }
        scores.push({
          briefId: id,
          channelId: creator.channelId,
          score,
          model: config.LLM_SCORE_MODEL,
          createdAt: stamp(),
        });
      }
    }
    console.log(`  scores: ${scores.length}`);

    const record = Example.parse({
      slug: example.slug,
      title: example.title,
      blurb: example.blurb,
      brief,
      search,
      scores,
      precomputedAt: stamp(),
    });
    const file = path.join(outDir, `${example.slug}.json`);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`  wrote ${path.relative(process.cwd(), file)}`);
  }

  const cache = getCache();
  console.log(
    `done: ${await llmRequestsToday(cache)} Gemini requests, ${await youtubeSearchesToday(cache)} YouTube searches`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
