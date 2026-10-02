# Creator Match

Next.js 16 (App Router, `src/`), TypeScript, Tailwind v4, deployed on Vercel from GitHub. A brand brief goes to Claude for YouTube search queries, YouTube Data API v3 for channels and stats, then Claude again for fit scores and outreach angles. No auth, no database. Upstash Redis is the cache and rate-limit store. `PLAN.md` has the data model, routes, tests, and build order. `BUILD_LOG.md` records each step.

## Commands

| Task                | Command                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| Dev server          | `npm run dev` (http://localhost:3000)                                                   |
| Production build    | `npm run build` then `npm run start`                                                    |
| Lint                | `npm run lint` (`eslint .`; Next 16 has no `next lint`, and `next build` does not lint) |
| Type check          | `npm run typecheck` (`tsc --noEmit`)                                                    |
| Tests               | `npm test` (`vitest run`), `npm run test:watch`                                         |
| Format              | `npm run format` (`prettier --write .`)                                                 |
| Precompute examples | `npm run precompute` (`tsx --env-file=.env.local scripts/precompute-examples.ts`)       |

## Workflow for every build step

1. Build the step from `PLAN.md`.
2. `npm run lint && npm run typecheck && npm test` must pass.
3. Commit with a message naming the step, push to `main`. Vercel auto-deploys.
4. Verify locally and on the live URL.
5. Append an entry to `BUILD_LOG.md`: date, step, what changed, how verified, timings, surprises.

## Environment

Copy `.env.example` to `.env.local`. Never commit `.env.local`. Set the same vars in Vercel.

| Var                                                                         | Purpose                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                                                         | Claude                                                                         |
| `YOUTUBE_API_KEY`                                                           | YouTube Data API v3, restricted to that API in Google Cloud                    |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN`                                      | Injected by the Vercel Upstash integration. Unset locally → in-memory cache    |
| `DEMO_PASSCODE`                                                             | Optional. Bypasses the per-visitor search limit                                |
| `RATE_LIMIT_SALT`                                                           | Random string for hashing visitor IPs                                          |
| `CLAUDE_QUERY_MODEL`                                                        | Default `claude-haiku-4-5` (query generation)                                  |
| `CLAUDE_SCORE_MODEL`                                                        | Default `claude-sonnet-5-5` (scoring and outreach, verified current Sonnet id) |
| `SCORE_CONCURRENCY`                                                         | Default 5. Max concurrent scoring calls per request                            |
| `CLAUDE_MAX_RETRIES`, `CLAUDE_TIMEOUT_MS`                                   | Defaults 3 and 30000                                                           |
| `VISITOR_SEARCH_LIMIT`, `YT_PUBLIC_SEARCH_BUDGET`, `YT_TOTAL_SEARCH_BUDGET` | Defaults 3, 60, 95 (see `src/lib/config.ts`)                                   |

## Layout

```
src/app/            page.tsx, layout.tsx, api/{brief,search,score,passcode,status}/route.ts (+ route.test.ts)
src/components/     BriefForm, ExampleButtons, PipelineStatus, CreatorGrid, CreatorCard, OutreachPanel, QuotaBanner, PasscodeDialog
src/hooks/          useMatchPipeline.ts
src/lib/            schemas, config, hash, cache, rate-limit, access, semaphore, claude, prompts, youtube, pipeline, ndjson, examples, errors
src/test/           setup.ts, fixtures.ts, mocks.ts
data/examples/      precomputed example results (committed)
scripts/            precompute-examples.ts
```

## Conventions

**Schemas.** `src/lib/schemas.ts` is the single source of truth; derive types with `z.infer`, never hand-write interfaces for data that has a schema. Every API route parses its body with the request schema and returns the matching response schema or `ErrorResponse` (`{ error: { code, message } }`). Error codes are the `ErrorCode` enum; throw `AppError` and let the route wrapper map it.

**Claude.** Only `src/lib/claude.ts` talks to the Anthropic SDK, through one client created with `maxRetries: 3` and `timeout: 30_000` (TypeScript SDK timeouts are milliseconds). The SDK already retries 408/409/429/5xx including 529 overloaded with exponential backoff and honors `retry-after`; do not write retry loops. `scoreCreator` runs behind the module-level semaphore sized by `SCORE_CONCURRENCY`. Use `client.messages.parse()` with `zodOutputFormat()` from `@anthropic-ai/sdk/helpers/zod` for every call; no prompt-engineered JSON, no prefill. Schemas given to `zodOutputFormat` contain no `min`, `max`, `length`, or `regex` constraints; describe ranges in `.describe()` and clamp after parsing. Always check `stop_reason` before reading content; refusal is a non-retryable `claude_error`. `parsed_output === null` gets one re-ask, then a non-retryable error. After retries are exhausted, `Anthropic.RateLimitError`, `Anthropic.InternalServerError`, and timeouts become retryable `claude_error`. Model ids come from `config.ts`, never inline. `max_tokens` is explicit per call. Scoring uses `output_config.effort: "low"`.

**YouTube.** Only `src/lib/youtube.ts` calls the API, and every call goes through the cache and the counters. `search.list` has its own bucket of 100 calls per day (`yt:searches:{pacificDate}`); `channels.list` and `videos.list` cost 1 unit each from the 10,000 unit pool (`yt:units:{pacificDate}`). Both reset at midnight Pacific, so counter keys use the Pacific date. Search videos (`type=video`) and aggregate channels; never `type=channel`. Use `maxResults=50`, cost is per call. Check the budget before a call, increment the counter before the call goes out.

**Cache and limits.** All reads and writes go through `src/lib/cache.ts`; keys and TTLs are in `PLAN.md`. Cached results never consume a visitor's limit. If Redis is unavailable in production, live search fails closed with `budget_exhausted`.

**Routes.** Node runtime (no edge). Secrets stay server-side. Read IP (`x-forwarded-for`, first entry) and cookies from the `Request` headers and set cookies via `Set-Cookie` on the `Response`; never import `next/headers`, so handlers run in tests. One JSON log line per request with stage timings. Keep route files thin: parse, call lib, respond. `/api/score` streams NDJSON `ScoreLine`s via `ndjson.ts`.

**UI.** Client components only where there is state or events. Reuse `Brief.safeParse` for form validation. Show creator cards as soon as `/api/search` returns and fill scores as each stream line arrives. Every error code has a human message in `useMatchPipeline`; retryable errors get a per-card "Retry".

**Tests.** Vitest, `environment: node`. Unit tests next to the module, route tests next to the route as `route.test.ts`, calling the exported handler with `new Request(...)`. Mock the Anthropic SDK (`vi.mock("@anthropic-ai/sdk")`) and the YouTube module (`vi.mock("@/lib/youtube")`) from `src/test/mocks.ts`; stub `fetch` only inside `youtube.test.ts`. Tests never touch the network or Redis; the memory cache is reset in `src/test/setup.ts`. `config.ts` reads env lazily so tests can `vi.stubEnv`. Every new route gets happy-path, limit, and failure cases.

**Style.** Prettier defaults, ESLint from `eslint-config-next`. Named exports. Small files. No new dependencies without a reason in the commit message.

**Examples.** `data/examples/*.json` must stay in sync with `briefId` hashing and the schemas. After changing `hash.ts`, `schemas.ts`, or the prompts, run `npm run precompute` and commit the output.

**Docs.** `README.md` describes the app for a visitor; keep the live link and limits current. `BUILD_LOG.md` gets an entry per step, never rewritten.

## Gotchas

- Windows dev machine. Scripts avoid inline env vars (`FOO=bar cmd`); use `.env.local` or `--env-file`.
- `tsx` resolves `@/*` from `tsconfig.json`; keep `scripts/` importing from `src/lib` only.
- Tailwind v4 is configured in `src/app/globals.css` (`@import "tailwindcss"`), not `tailwind.config.js`.
- Vercel Hobby with Fluid compute allows 300 s per function. Latency, not timeouts, is the constraint.
- The Vercel Upstash integration names the env vars `KV_REST_API_URL` / `KV_REST_API_TOKEN`; `Redis.fromEnv()` reads them directly.
- `AGENTS.md` is written by `next dev` on every start and points at `node_modules/next/dist/docs/` for Next 16 APIs. Keep it committed; deleting it only recreates an uncommitted change.
- `npm run typecheck` runs `next typegen` first because `next-env.d.ts` imports `.next/types/routes.d.ts`, which does not exist on a fresh clone.
