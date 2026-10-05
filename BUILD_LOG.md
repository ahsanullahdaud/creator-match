# Build log

One entry per build step from `PLAN.md`, appended in order, never rewritten.

## Step 1 - Scaffold (2026-10-02)

### Planning decisions carried into the build

- **Cache: Upstash Redis via the Vercel Marketplace, not in-memory.** Vercel functions are stateless, so in-process counters would not protect the 100 search per day quota. Local dev falls back to an in-memory map when the KV env vars are unset.
- **Short form with example buttons.** Brand name, product and audience are required. Goal, subscriber range, region and language are dropdowns with defaults. Notes optional. Three "try an example" buttons fill and submit the form in one click and serve precomputed results.
- **Open page with per-visitor limits instead of a passcode gate.** The link goes on a CV, so anyone can use it. Live searches are limited to 3 per visitor per day by hashed IP, plus a global daily search budget that falls back to the examples with a friendly message. A passcode is optional and only lifts the per-visitor limit for demos.
- **Sonnet instead of Opus for scoring.** `claude-sonnet-5-5`, confirmed as the current Sonnet id from the models docs on 2026-10-02, for cost and latency. Haiku 4.5 generates the search queries.
- **Deploy moved to step 2.** GitHub and Vercel get the placeholder right after scaffolding, so every later step is verified on the live URL as well as locally. The final step is polish only.
- **One streamed score request instead of ten parallel ones.** A single `/api/score` call runs all creators through a concurrency limiter (default 5) with SDK backoff on 429 and 529, and streams one NDJSON line per creator. The cap is enforced inside one function invocation and cards still fill in progressively.
- **YouTube quota model corrected.** The quota docs now give `search.list` its own bucket of 100 calls per day, separate from the 10,000 unit pool for `channels.list` and `videos.list`. Counters track search calls and list units separately, keyed by the Pacific date.

### What was built

- `create-next-app@latest` (Next.js 16.3.8) with TypeScript, Tailwind v4, ESLint, App Router, `src/`, npm, `@/*` alias. Git init skipped because step 2 owns it.
- Dependencies: `zod` 4, `@anthropic-ai/sdk` 0.131, `@upstash/redis` 1.39. Dev: `vitest` 5, `prettier`, `tsx`. `@types/node` bumped from ^20 to ^26 because Vitest 5 requires ^22 or newer and the runtime is Node 26.9.
- Scripts: `lint` (`eslint .`), `typecheck` (`next typegen && tsc --noEmit`), `test`, `test:watch`, `format`, `precompute`.
- `vitest.config.mts` with `environment: node` and the `@` alias. Named `.mts` because Vitest warned that a `.ts` config is loaded as CommonJS.
- `.env.example` listing every variable from `CLAUDE.md`. `.gitignore` un-ignores `.env.example`, since the template ignores `.env*`.
- `src/test/smoke.test.ts`, `README.md` stub, `.prettierignore`, this log. The template's `AGENTS.md` (Next.js guidance for coding agents) is kept.

### Verification

- `npx eslint .` clean. `npx tsc --noEmit` clean. `npx vitest run`: 1 file, 1 test passed.
- `next dev` ready in 1.7 s. `GET /` returned HTTP 200 with the template page (title "Create Next App"), 5.3 s on first compile.
- Live URL: not yet. Deploy is step 2.

### Surprises

- `create-next-app` refuses a directory that already contains `PLAN.md` and `CLAUDE.md`. They were parked in a temp folder during scaffolding and moved back.
- `tsc --noEmit` depends on `.next/types/routes.d.ts`, which only exists after `next dev`, `next build` or `next typegen`. The `typecheck` script runs `next typegen` first so a fresh clone passes.
- Vitest 5 and the template's `@types/node@^20` conflict; resolved by matching `@types/node` to the installed Node major.

## Step 2 - GitHub and Vercel (2026-10-02)

### What was done

- `git init -b main`. No git identity existed on this machine, so `user.name` and `user.email` were set per-repo to the GitHub profile name and the GitHub noreply address.
- Pre-commit review: 26 files staged. The only env-named file is `.env.example`, whose values are empty or placeholders. No `.env.local` exists on disk. A pattern scan of the staged content for Anthropic, Google, GitHub and AWS key shapes, private-key blocks, and `key=` / `token=` / `secret=` assignments found nothing.
- `NPM COMMANDS.txt`, a personal command cheat sheet found in the project root, was kept out of the repo through `.git/info/exclude` (local-only ignore, not committed).
- Added `.gitattributes` (`* text=auto eol=lf`, binaries marked) so Windows checkouts stay LF and Prettier and Git agree on line endings.
- Commit `9aa151f` "Step 1: scaffold Next.js 16 app with tooling". `gh repo create creator-match --private --source=. --push` created https://github.com/ahsanullahdaud/creator-match and pushed `main`.

### Pending

- Vercel import and first deploy. The Vercel CLI on this machine is logged out and login is interactive, so the import happens in the Vercel dashboard (New Project, pick the GitHub repo, keep defaults, no env vars yet). The live URL check will be appended below once the deployment exists.

### Surprises

- `gh` was installed after this shell session started, so it was missing from PATH in both shells. Invoked by full path, `C:\Program Files\GitHub CLI\gh.exe`.
- Git for Windows warned about LF to CRLF conversion on every file; the `.gitattributes` above settles it.

### Vercel deploy (2026-10-02, later)

- The Vercel project already existed and was connected to the GitHub repo but had no production deployment. Empty commit `a3bb252` "Trigger first Vercel deploy" pushed to `main`.
- Build passed. GitHub deployment `6814097709`, environment Production, state `success`; Vercel commit status "Deployment has completed". From push to success in under 30 s.
- The generated URLs (`creator-match-or5fjb2bq-ahsanullahdaud.vercel.app`, `creator-match-ahsanullahdaud.vercel.app`, `creator-match-git-main-ahsanullahdaud.vercel.app`) all redirect to Vercel login: Standard Protection is on, which is the default and is fine. The open production domain is a different hostname because `creator-match.vercel.app` was already taken by an unrelated project.
- Production domain found and verified: https://creator-match-seven.vercel.app. Vercel assigned the `-seven` suffix because the bare name was taken. Confirmed by changing the page title in `src/app/layout.tsx` (commit `e5cffd9`), which deployment `6814161731` picked up within a minute of the push. The domain returns 200 with title "Creator Match" and the new description meta. Step 2 complete.

## Step 3 - Schemas, config, hashing, errors, semaphore (2026-10-02)

### What was built

- `src/lib/schemas.ts`: every Zod schema from PLAN.md plus `clampFitScore`, `PasscodeRequest`, and the `internal` error code (500) for unexpected failures, which the plan's enum lacked. Claude-facing schemas carry no numeric or length constraints.
- `src/lib/config.ts`: `getConfig()` reads the environment lazily, treats empty strings as unset so a copied `.env.example` works, coerces numbers, and rejects a public search budget above the total or above YouTube's 100-call cap. `LIMITS` and `TTL_SECONDS` hold the fixed constants.
- `src/lib/hash.ts`: `briefId` (16 hex chars over canonical, normalized JSON), `ipHash` (salted), `queryHash`, `canonicalJson`, `normalizeText`, `pacificDate`, `utcDate`.
- `src/lib/errors.ts`: `AppError` with code to status mapping, `retryable` flag and `cause`; `toErrorResponse` turns any thrown value into the `ErrorResponse` JSON shape and hides non-AppError messages behind a logged 500; `fromZodError` names failing fields.
- `src/lib/semaphore.ts`: counting semaphore with FIFO waiters, `run()` that always releases, idempotent release.
- `src/test/setup.ts` (unstubs env, restores mocks and timers after each test) and `src/test/fixtures.ts` (brief, query plan, creator, score). `smoke.test.ts` removed. 35 unit tests across five files.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean, 5 files, 35 tests, under 1 s.
- Commit `26025b3` pushed. Vercel deployment `6814629219` succeeded; https://creator-match-seven.vercel.app returns 200 with title "Creator Match".

### Surprises

- Next's type augmentation makes `NODE_ENV` a required key of `NodeJS.ProcessEnv`, so a test passing a plain object to `getConfig` failed `tsc`. The parameter is now `Record<string, string | undefined>`, which `process.env` still satisfies.
- The first attempt to write all files in one shell command failed with `ENAMETOOLONG` on spawn; files were written in smaller batches.

## Step 4 - Cache layer and status route (2026-10-02)

### What was built

- `src/lib/cache.ts`: `CacheStore` interface (`get`, `set` with TTL, `incr` with TTL on first creation, `del`). `MemoryStore` for local dev and tests, with expiry on read. `RedisStore` over `@upstash/redis` with JSON handled locally (`automaticDeserialization: false`) so both stores behave identically. `getCache()` picks Redis when both `KV_REST_API_*` variables are set, otherwise memory, and warns once in production when falling back. `resetCache()` for tests.
- `src/lib/route.ts` (not in the plan's module list, added as the route wrapper CLAUDE.md refers to): `handle()` maps thrown errors to the JSON error shape, forces `cache-control: no-store`, and writes one JSON log line per request with status, duration, and any stage timings the route adds. `json()` builds responses.
- `src/app/api/status/route.ts`: Node runtime, force-dynamic. Does a real cache round trip so bad Redis credentials surface here, then returns `StatusResponse` with the store kind, default visitor numbers, `budget: "ok"`, `maxCreators`, and an empty examples list. Visitor counters, budget state and examples come in steps 7, 9 and 11.
- Tests: memory store TTL and counter semantics with fake timers, Redis adapter against a mocked Upstash client (asserts `ex` on set and a single `expire` per counter), store selection from env, the route wrapper, and the status route. 50 tests total.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean, 8 files, 50 tests.
- Local, against the running dev server: `GET /api/status` returned 200, `cache-control: no-store`, `store: "memory"`.
- Commit `1a8416b` pushed. Vercel deployment `6814998720` succeeded. Live `GET https://creator-match-seven.vercel.app/api/status` returned 200 with `store: "redis"`, confirming the Marketplace Upstash variables are injected and the round trip works.

### Surprises

- The shared test setup imported the cache module at load time, which pulled in the real Upstash client before a test file's `vi.mock` of it applied. The setup now imports `resetCache` lazily inside `afterEach`.
- Next 16 refuses to start a second `next dev` for the same directory while one is running, so the local check used the existing server on port 3000.

## Step 5 - Brief form (2026-10-02)

### What was built

- `src/components/BriefForm.tsx`: three required text inputs (brand, product, audience), four selects with defaults (goal, channel size, region, language), optional notes, submit. Validates with `Brief.safeParse` on submit and shows one friendly message per field ("Required", "Too short, at least N characters", "Too long"). Inputs use 16px text so iOS does not zoom on focus, and the layout is a single column on phones with the four selects in a 2x2 grid that becomes one row on wider screens. Takes a `busy` prop for the pipeline steps to come.
- `src/components/ExampleButtons.tsx`: three pill buttons that fill the form and submit it in one click.
- `src/components/MatchWorkspace.tsx`: the client wrapper that owns page state. For now it logs the parsed brief to the console and shows it in a "Brief ready" panel, so verification works on a phone where there is no console. Step 6 replaces this with the pipeline.
- `src/lib/labels.ts` (human labels for every dropdown value, typed so a new enum value fails to compile without a label) and `src/lib/example-briefs.ts` (the three fictional briefs from PLAN.md, parsed through the schema). Both have tests. 54 tests total.
- `src/app/page.tsx` rewritten: header line, workspace, footer. Template SVGs removed (which also removed the empty `public/` folder). Body font changed from the template's Arial to Geist.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean, 10 files, 54 tests.
- Local, against the running dev server: `GET /` returned 200 with all 8 field names, 3 example buttons, the submit button, and no template text.
- Commit `02dbfb3` pushed. Vercel deployment `6815222261` succeeded. Live `GET /` shows the same 8 fields, 3 examples, and submit.

### Surprises

- A shell heredoc holding the JSX component failed to parse as a command, so the two component files were written with the file tool instead of a heredoc.
- `git rm` of the last files in `public/` deleted the folder itself. Next does not need it, and `favicon.ico` lives under `src/app`.

## Plan change - Gemini instead of Claude (2026-10-05)

Decided before step 6, so no LLM code exists yet. The user chose the Google Gemini API free tier for both query generation and scoring, with the LLM calls kept behind one module so the provider can be swapped later.

### Facts checked on ai.google.dev and npm

- Official SDK: `@google/genai` 2.27 (Node 20+). It replaces `@google/generative-ai`. The docs now lead with the Interactions API (`ai.interactions.create`); `generateContent` is described as legacy but fully supported.
- Models with a free tier: Gemini 3.8 Flash, 3.5 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite. Gemini 3.1 Pro is paid only. Free-tier tokens cost nothing; Google may use free-tier content to improve its products.
- Free-tier requests per minute and per day are not printed in the docs. They are shown per project at aistudio.google.com/rate-limit and change without notice. Third-party reports from September 2026 put 3.5 Flash-Lite near 500 requests/day and the newest 3.8 Flash far lower. Exceeding them returns `429 RESOURCE_EXHAUSTED`. Quotas reset at midnight Pacific.
- Structured output: `response_format: { type: "text", mime_type: "application/json", schema }` with a JSON Schema subset (object, array, string, number, integer, boolean, null; required, additionalProperties, enum, minimum/maximum, minItems/maxItems, description). Output is text in `output_text`, so the caller parses and validates it.
- SDK retries and timeouts: `httpOptions.retryOptions` (attempts, initialDelay, maxDelay, expBase, jitter, httpStatusCodes) and `httpOptions.timeout` (ms). Errors are `ApiError` with an HTTP `status`.

### Decisions

- Both calls default to `gemini-3.5-flash-lite`; `gemini-3.8-flash` is an env switch for scoring if its quota allows. Ids live in env only, no `-latest` aliases.
- Scoring is batched: 5 creators per request, two batches per brief, so a fresh brief costs 3 LLM requests instead of 11. The streamed NDJSON response stays; lines are emitted per creator as each batch completes.
- Concurrency cap 2 (`LLM_CONCURRENCY`), SDK retries 2 (`LLM_MAX_RETRIES`), 30 s timeout, and a daily request counter `llm:requests:{pacificDate}` that fails closed at `LLM_DAILY_REQUEST_BUDGET` (450).
- Provider boundary: `src/lib/llm/provider.ts` (interface and `LlmError`), `src/lib/llm/gemini.ts` (the only `@google/genai` import), `src/lib/llm.ts` (what the app calls). Error code `claude_error` becomes `llm_error`.
- Tests mock `@google/genai` and cover happy path, invalid JSON then valid, safety block, 429 after retries, batch and concurrency counts, and the daily budget.

### Code changes deferred to step 6

`npm uninstall @anthropic-ai/sdk && npm install @google/genai`; `claude_error` to `llm_error` in `schemas.ts`, `errors.ts` and their tests; `CLAUDE_*` and `SCORE_CONCURRENCY` replaced by the `LLM_*` variables in `config.ts` and `config.test.ts`; `CreatorScoreBatch` schema added.

## Step 6 - Query generation with Gemini (2026-10-05)

### What was built

- Provider switch: `@anthropic-ai/sdk` removed, `@google/genai` 2.27 added. `CLAUDE_*` and `SCORE_CONCURRENCY` replaced by the `LLM_*` variables in `config.ts` and its tests; `claude_error` renamed `llm_error`; `ErrorResponse` gained an optional `retryable`; `CreatorScoreBatch` schema added for step 8.
- `src/lib/llm/provider.ts`: `LlmProvider`, `StructuredRequest`, `StructuredResult`, `LlmError` with a kind and retryable flag. No SDK imports.
- `src/lib/llm/gemini.ts`: the only file importing `@google/genai`. Calls `ai.interactions.create` with `system_instruction`, `response_format` (JSON Schema) and `generation_config` (`thinking_level: "low"`, `max_output_tokens`), passing per-request `timeout`, `retries` (attempt-count backoff, `LLM_MAX_RETRIES`) and `retry_codes` 408/429/5xx. Maps `ApiError` statuses, timeouts, failed or empty interactions to `LlmError`.
- `src/lib/llm.ts`: what the app calls. `generateQueries(brief)` builds the JSON Schema with `z.toJSONSchema` (minus `$schema`), reserves a daily LLM request, runs behind the `LLM_CONCURRENCY` semaphore, strips code fences, parses and Zod-validates, re-asks once, maps errors to `llm_error`, drops blank queries and truncates to 3.
- `src/lib/prompts.ts` (system prompt and brief formatter), `src/lib/keys.ts` (every cache key), `src/lib/rate-limit.ts` (`reserveLlmRequest` against `llm:requests:{pacificDate}`), `readJson` in `route.ts`.
- `POST /api/brief`: validate, `briefId`, cache hit returns `cached: true`, otherwise generate, store 7 days, return.
- Client: `useMatchPipeline` hook (brief stage, friendly error messages) and `PipelineStatus` panel showing the three stages, the queries with intents, themes and avoid list, and a "cached" badge. `MatchWorkspace` now runs the pipeline instead of logging.
- Tests: 14 files, 80 tests. `/api/brief` covers happy path with the exact Gemini call shape, cache hit, invalid and non-JSON body, empty answer, invalid JSON then valid, two invalid answers, 429 after retries, budget exhausted, truncation, missing key. Plus provider error mapping, concurrency cap, budget counter.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- Local, through the running dev server: LoomNotes brief returned 3 queries in 6.3 s (first compile included), then `cached: true` in 228 ms.
- Commit `fd9f74b` pushed. Vercel deployment `6857045006` succeeded. Live: Peak Fuel brief returned 3 queries in 3.1 s, then `cached: true` from Redis in 594 ms. Live `/api/status` still reports `store: "redis"`.
- Gemini requests spent during verification: 2 (one local, one live).

### Surprises

- Shell commands above roughly 8 KB get broken mid-heredoc by the tool and fail with an unmatched-quote error before anything runs. Files are now written in commands under that size.
- The Interactions client in `@google/genai` takes `timeout`, `retries` and `retry_codes` per request, not through the constructor's `httpOptions` as the classic client does.

## Step 7 - YouTube search and creator cards (2026-10-05)

### What was built

- `src/lib/youtube.ts`: `searchVideos` (search.list, `type=video`, 50 results, region and language filters only when set; cached 7 days by normalized query; a miss reserves one of today's searches first) and `getChannels` (channels.list for up to 50 ids, per-channel 24 h cache, one call for the misses, one quota unit). `quotaExceeded` maps to `budget_exhausted`, other failures to `youtube_error` (retryable on 5xx). The API key is only ever in the URL, never in an error message.
- `src/lib/pipeline.ts`, pure: `aggregateHits` (a channel counts once per query, keeps its 3 newest videos), `pickCandidates` (hits then recency, cap 50), `eligible` (hidden subscriber counts out, fewer than 5 videos out, subscriber range with an exclusive upper bound), `toCreator`, `rankCreators` (hits × 3 + range fit + recency bonus + region match, ties by subscribers, cap 10), `selectCreators`.
- `src/lib/rate-limit.ts`: `reserveYoutubeSearch` with the public threshold (60) or the total one (95) for a passcode holder, `countYoutubeUnit`, `budgetState` (ok, low under 10 left, exhausted). `src/lib/format.ts` for 42K-style counts.
- `POST /api/search`: brief record or 404, cache hit returns `cached: true`, otherwise the three queries run in parallel, partial failures are tolerated as long as one query answered, candidates go through channels.list, filter, rank, store 7 days (1 day when empty). Visitor numbers are still the defaults until step 9. `GET /api/status` now reports the real budget state.
- Client: the pipeline hook runs brief then search and surfaces per-stage errors; `PipelineStatus` shows both stages with timings and the queries as chips; `CreatorGrid` and `CreatorCard` render rank, thumbnail (next/image with YouTube hosts allowed in `next.config.ts`), handle, subscribers, videos, country, matched videos, and how many searches matched. Empty state explains the size range.
- Tests: youtube.ts with `fetch` stubbed (params, caching, budget refusal, quota mapping, key never leaked, parsing), pipeline ranking math, search route with the YouTube module mocked (happy, cached, budget exhausted, partial, YouTube down, empty result, budget state), rate limits, status budget, format. 18 files, 108 tests.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- Local, through the running dev server: LoomNotes search returned 10 channels in 1.9 s (3 live searches, 1 unit), the repeat came from cache in 0.7 s with 0 searches. The brief had to be regenerated (1 Gemini request) because the `next.config.ts` change restarted the dev server and emptied its memory cache.
- Commit `d57524a` pushed. Vercel deployment `6858990150` succeeded. Live: Peak Fuel brief served from Redis, search returned 10 channels in 1.5 s (3 live searches, 1 unit), repeat from Redis in 0.7 s. Live `/api/status` reports `budget: "ok"`.
- Real `search.list` calls spent in this step: 6 of 100 (3 local, 3 live). Gemini requests: 1.

### Surprises

- Next 16 writes dev logs under `.next/dev/logs/`, but the file was not present on this run, so the per-request log line was checked on the live deployment instead of locally.
- Ranking with only three queries rarely produces a channel with more than 2 hits, so recency and region do most of the ordering below the top spots. Worth revisiting once scores exist.
