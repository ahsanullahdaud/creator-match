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

## Step 8 - Scoring (2026-10-05)

### What was built

- `scoreCreators(brief, plan, creators)` in `src/lib/llm.ts`: one Gemini request per batch using the `CreatorScoreBatch` schema, results keyed by channelId, scores clamped, unknown or duplicate ids ignored. `SCORE_SYSTEM_PROMPT` carries the rubric (80+ only for an obvious fit, verdict thresholds, reasons must cite the given data, outreach rules) and `scorePrompt` sends the brief, today's date, the themes and avoid list, and the candidates as compact JSON.
- `src/lib/ndjson.ts`: `ndjsonResponse` streams one JSON object per line as the generator yields; `readNdjson` parses lines as they arrive, including lines split across chunks.
- `POST /api/score`: validates ids against the brief's search results, emits cached scores first, enforces the 10-per-brief cap with `score_cap` lines, splits the rest into batches of `LLM_SCORE_BATCH_SIZE`, runs them through `scoreCreators` (the semaphore in `llm.ts` caps concurrency), and emits each batch's lines the moment it lands. A skipped channel gets a retryable error line; a failed batch gets one error line per creator with the error's code and retryable flag; a `done` line closes the stream. Failures are neither cached nor counted.
- Client: the pipeline hook runs a third stage that reads the stream and updates each card as its line arrives, with per-card retry for retryable failures. `CreatorCard` shows a skeleton, then the fit badge with verdict, reasons, concerns, audience overlap, and `OutreachPanel` (angle, subject line, opening message, copy buttons). `CreatorGrid` re-orders by fit once scoring settles. `PipelineStatus` shows scoring progress and the end-to-end total.
- Tests: `/api/score` happy path (10 ids, exactly 2 requests, 10 lines plus done, counters), cached, score cap, 404 and 400; failure paths (concurrency never above `LLM_CONCURRENCY`, safety block, 429, skipped channel, daily budget, unexpected throw); `scoreCreators` mapping; NDJSON round trips. 21 files, 122 tests.

### Verification and timings

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- Local, LoomNotes through the dev server. The dev server's memory cache had been emptied (a restart), so the brief and search ran live after all. Brief 3.7 s (1 Gemini request), search 0.8 s (3 real searches, 1 unit), scoring 8.9 s for 10 channels in 2 requests, 13.5 s end to end. Repeat scoring call: 113 ms, all 10 from cache.
- Commit `6831a21` pushed. Vercel deployment `6859294422` succeeded. Live, Peak Fuel: brief 0.8 s (cached), search 0.5 s (cached), scoring streamed with the first batch of 5 at 6.5 s and the second at 7.8 s, 10 scored, 0 failed. End to end 9.1 s. Repeat scoring call: 0.7 s, all from Redis.
- Spent in this step: Gemini requests 5 (3 local, 2 live), YouTube searches 3 (all local, because of the cleared dev cache; 0 live).
- Score spread on the live run: 38 to 85, verdicts weak to strong, so the rubric separates channels rather than rating everything high.

### Surprises

- Nothing is streamed before the first batch finishes, so the response headers themselves arrive at about 6.5 s on a cold brief. Cached scores do go out immediately. Acceptable: the cards already show skeletons from the search stage.
- TypeScript does not carry a null check into a nested generator function, so the brief record is destructured before `lines()` is defined.

## Step 9 - Visitor limits and quota banner (2026-10-05)

### What was built

- `src/lib/rate-limit.ts`: `clientIp` (first `x-forwarded-for` entry, then `x-real-ip`, else `local`), `visitorId` (salted hash, the only form that reaches the cache or logs), `visitorSearchStatus`, `checkVisitorSearch`, `countVisitorSearch` (one count per `/api/search` run that hit YouTube), `checkVisitorBrief`, `countVisitorBrief` (one count per `/api/brief` cache miss). Buckets are per visitor and UTC day; a `bypass` flag (step 10's passcode) reports limits without enforcing them.
- `/api/search` checks the allowance after the cache lookup, so cached results stay free, and counts only runs with at least one live search. `/api/brief` checks and counts before spending a model request. `/api/status` and the search response carry the visitor's remaining allowance.
- `QuotaBanner`: "2 of 3 live searches left today", a warning at 0 pointing at the examples, the global low or exhausted budget, and passcode state. The page fetches status on load and after each run so the banner counts down.
- Tests: IP parsing and hashing, search and brief buckets with bypass and day rollover, the search route refusing at the limit before any YouTube call, counting live runs once, separate buckets per IP, cached and query-cache runs not counting, the brief route refusing past its limit and not counting cached briefs, the status route per IP. 21 files, 132 tests.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- Local, against a production build on port 3011 started with `VISITOR_SEARCH_LIMIT=1` in the process environment: fresh Terra Cookware brief (1 Gemini request), its search ran live (3 searches) and left `remaining: 0`; a second fresh brief (1 Gemini request) got `429 visitor_limit` on search before any YouTube call; the first search again was `cached: true` and free. The server log shows `live_searches: 3`, then the 429 in 1 ms, then the cached hit.
- Commit `6dcf5f6` pushed. Vercel deployment `6859790133` succeeded. Live: status showed 3 remaining; the cached Peak Fuel search left it at 3; a fresh Terra Cookware brief (1 Gemini request) and search (3 searches) dropped it to 2; status confirmed 2.
- Spent in this step: Gemini requests 7 attempted, 5 succeeded (4 attempts on the dev server with 2 failures, 2 on the production build, 1 live); YouTube searches 6 (3 local, 3 live).

### Surprises

- Changing `.env.local` makes the dev server reload the environment and re-evaluate server modules, which empties the in-memory cache. That is also why earlier steps found the dev cache "emptied". The limit check therefore ran against `next start` on another port with the variable set in the process environment, which Next 16 allows alongside the dev server because dev output lives in `.next/dev`.
- The two brief calls made right after an env reload failed, one with `Gemini request timed out` after the SDK's own retries; the same calls succeeded a minute later. The 30 s timeout spans the SDK's retry attempts, so a run of transient failures reports as a timeout. It is marked retryable and the card offers Retry. Not reproduced in steady state.
- `/api/brief` responses carry no visitor field, which is fine since the banner refreshes from `/api/status` after every run.

## Step 10 - Demo passcode (2026-10-05)

### What was built

- `src/lib/access.ts`: `verifyPasscode` (constant-time compare, false when none is configured), `passcodeToken` (HMAC-SHA256 of the passcode keyed by `RATE_LIMIT_SALT`, so the browser only ever holds a token), `hasBypass` (cookie token must match the current passcode and salt), `readCookie`, `passcodeCookie` (`cm_pass`, Path=/, 30 days, HttpOnly, SameSite=Lax, Secure only over https so localhost works), `clearPasscodeCookie`.
- `POST /api/passcode` grants the cookie for the right passcode, 403 `forbidden` otherwise or when none is configured, 429 `visitor_limit` after 20 attempts per visitor per day. `DELETE /api/passcode` clears it.
- Bypass wiring: `/api/brief` skips the brief allowance, `/api/search` skips the search allowance and asks YouTube against the total budget (95) instead of the public one (60), `/api/status` and the search response report `bypass: true` and judge the budget against the total threshold. Every log line now carries `bypass`.
- `PasscodeDialog` under the banner: "Have a passcode?" opens a password field; success refreshes the status so the banner reads "Passcode active"; "Turn off" clears the cookie. The banner now prefers the freshly fetched status over the last search response.
- Tests: access module (compare, cookie parsing, token binding to passcode and salt, cookie attributes, Secure rules), passcode route (grant, refuse, attempt cap, clear), bypass through the search, brief, and status routes, budget threshold with bypass. 23 files, 145 tests.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- Local, against a production build on port 3011 started with `VISITOR_SEARCH_LIMIT=0`, `YT_PUBLIC_SEARCH_BUDGET=0` and `YT_TOTAL_SEARCH_BUDGET=0` in the process environment: wrong passcode 403; right passcode 200 with the cookie; status with the cookie `bypass: true`; a fresh brief (1 Gemini request); the same search answered `429 visitor_limit` without the cookie and `503 budget_exhausted` with it, which proves the visitor check was bypassed and the global budget still applied, with no search spent; DELETE then status `bypass: false`.
- Commit `1fbae32` pushed. Vercel deployment `6860322502` succeeded. Live: wrong passcode 403; right passcode 200 with `cm_pass=...; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`; status with the cookie `bypass: true`; the cached Peak Fuel search free under bypass; DELETE then status `bypass: false`.
- Spent in this step: Gemini requests 1 (the local fresh brief), YouTube searches 0.

### Surprises

- The plain live status afterwards showed 0 of 3 searches left for this IP. The machine running these checks shares its public IP with the user's own browser testing after step 9, so that is their usage, not a bug. The passcode is exactly the escape hatch for this.
- The passcode value was read from `.env.local` into a shell variable and sent through a JSON encoder, never echoed; the cookie jar files held only the HMAC token and were deleted.

## Step 11 - Precomputed examples (2026-10-05)

### What was built

- `scripts/precompute-examples.ts` (`npm run precompute`, optionally with slugs): runs `generateQueries`, the YouTube search and ranking pipeline, and batched `scoreCreators` through the lib functions for each example brief, then writes `data/examples/<slug>.json` as an `Example` record (brief, search and score records plus `precomputedAt`). Prints the Gemini and YouTube counts at the end.
- `src/lib/examples.ts` imports the three JSON files statically, so they are bundled into the serverless functions, validates them against the schema, and indexes them by cache key. `ExampleBackedStore` in `cache.ts` wraps the real store: reads of an example's `brief:`, `search:` or `score:` key are answered from the bundle, writes never touch it. The routes needed no change to serve examples for free.
- `/api/status` lists the examples. The pipeline hook records whether a run came from an example; the status panel shows a "precomputed" badge and "no quota spent", and offers the example buttons inside the error box when a run is blocked by `budget_exhausted` or `visitor_limit`. Picking one there remounts the form with the example's values and runs it.
- The test fixture brand became "Peak Fuel Labs" because the fixture had been identical to the Peak Fuel example and thirty route tests started answering from the precomputed layer. Fixtures must never collide with real example data.
- Tests: example files match `EXAMPLE_BRIEFS` one to one and are internally consistent, read-through serves them without writes, the full pipeline runs with every budget at zero and no external calls, the status route lists them. 24 files, 149 tests.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- `npm run precompute` ran once: 59 s, 9 Gemini requests, 9 YouTube searches, 10 creators and 10 scores per example.
- Local, against a production build on port 3011 with `VISITOR_SEARCH_LIMIT`, `VISITOR_BRIEF_LIMIT`, both YouTube search budgets and `LLM_DAILY_REQUEST_BUDGET` all set to 0: each example returned a cached brief, a cached search with 10 creators and 10 cached score lines, in 66 to 88 ms end to end; a non-example brief was refused with 429 before any call; the server log contains no `live_searches` or `llm_ms` entries.
- Commit `6794889` pushed. Vercel deployment `6860628547` succeeded. Live, with this IP already at 0 of 3 searches: all three examples returned full scored results in 485 to 702 ms, and `/api/status` was identical before and after.
- Spent in this step: Gemini requests 9, YouTube searches 9, all by the single precompute run. The checks spent nothing.

### Surprises

- The example JSON is bundled through static imports rather than read from disk at runtime, because Vercel's function bundles only include files the bundler can see.
- An inline Node check script mixing `require` with top-level `await` fails on Node 26 with `ERR_AMBIGUOUS_MODULE_SYNTAX`; the check moved to an `.mjs` file. The first live run of the checks produced no output for that reason and was repeated.

## Step 12 - Polish (2026-10-05)

### What was built

- Form: a hint under Brand name says it is used in the outreach drafts, not the search, and that product and audience drive the results. The form knows which example it was filled from: untouched, the button reads "Show results" with "costs nothing"; edited, the button reads "Run live search" with an amber note that it uses a daily search. `normalize.ts` holds the client-safe brief normalization that `hash.ts` now shares, so the form's "same brief" check matches the server's `briefId`. Channel-size labels shortened for two columns at phone width.
- Skeleton cards while YouTube is searched, an SVG icon in place of the template favicon, Open Graph metadata, and a footer naming the Gemini free tier and public YouTube data, the data-use caveat, the GitHub repo, and Claude Code.
- YouTube search titles arrive HTML-escaped (`&amp;`, `&#39;`); `decodeHtml` fixes them on the way in and when rendering precomputed data.
- Phone layout: Chrome's headless `--window-size=375` is clamped to a minimum window width on Windows and crops rather than reflows, so the check moved to Puppeteer device emulation (375 px, DPR 2, touch) against the live site, tapping the precomputed Peak Fuel example at no cost. The results page measured 698 px wide: matched-video links were inline anchors inside truncating list items, and their unwrapped width extended the document. Links are now truncating blocks, cards clip their contents, and long text breaks. After the fix both the form and the results page measure exactly 375 px.
- README rewritten for a hiring manager first: summary, live link, screenshot, five-step pipeline, engineering decisions with reasons, how Claude Code was used across planning, implementation, debugging, testing and refactoring, local setup, limits, next steps. `docs/screenshot.png` is a real above-the-fold capture of the live site.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean, 25 files, 151 tests.
- Commits `39529bc` (polish), `5845fb5` (overflow and entities) and this entry pushed; Vercel deployments `6860983447` and `6861107401` succeeded. Live checks: footer text, GitHub link, Claude Code link, brand hint and `/icon.svg` (200, `image/svg+xml`) present; emulated phone form and results pages at 375 px with no horizontal overflow; desktop at 1280 px.
- Spent in this step: 0 Gemini requests, 0 YouTube searches. Every live check used the precomputed Peak Fuel example.
- Git history scanned before going public (all 26+ commits): the only env-like file ever committed is `.env.example`; key-shaped patterns (Google, Anthropic, GitHub, AWS, private keys, Upstash tokens, Bearer, Vercel, cookie tokens, filled `*_KEY=` lines) all 0, the five Upstash hostname hits are the fake `example.upstash.io` in tests; the real values of `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `DEMO_PASSCODE` and `RATE_LIMIT_SALT` from `.env.local` appear 0 times.

## Summary

- **Elapsed.** About 8 hours of working sessions: 2 October, roughly 16:10 to 19:20 (plan, scaffold, deploy, schemas, cache, form); 5 October, roughly 11:00 to 15:30 (Gemini plan change, LLM, YouTube, scoring, limits, passcode, examples, polish). 28 commits before this final note.
- **Tests.** 151 across 25 files, all with the Gemini SDK and the YouTube client mocked; the suite spends no quota.
- **Final timings.** Fresh brief live: brief 3.1 s, search 1.5 s, scoring 7.8 s for 10 channels in two batches, about 12 s end to end; with a cached brief and search, 9.1 s. Repeats and the three examples: 0.4 to 0.7 s live, under 100 ms on a local production build.
- **Quota spent over the whole build.** YouTube searches about 36 of the 100-a-day bucket in total across all days; Gemini requests about 45. Most of it went to the one precompute run and to live verification of fresh briefs.
- **Three debugging stories worth reading.**
  1. _Finding the production domain (step 2)._ Every URL GitHub's deployment record exposes redirected to Vercel's login because Standard Protection hides generated URLs, and `creator-match.vercel.app` belonged to someone else. Probing suffixes found `-seven` serving the template page, which proves nothing on its own; changing the page title and watching that domain pick up the new deployment proved ownership.
  2. _The vanishing dev cache (steps 7 to 9)._ Editing `.env.local` makes the dev server reload the environment and re-evaluate server modules, which empties the in-memory cache, and the first Gemini calls after a reload timed out. Verification moved to a production build on a second port with limits set in the process environment, which Next 16 allows beside the dev server. That pattern made the zero-quota proofs in steps 9, 10 and 11 possible.
  3. _Thirty tests that passed for the wrong reason (step 11)._ The test fixture brief was identical to the Peak Fuel example, so as soon as the precomputed read-through existed, route tests started answering from it and asserting on the wrong data. Renaming the fixture brand fixed it; the lesson is that fixtures must never collide with real data the app ships.

## Fix - Fail closed when Redis is unavailable (2026-10-05)

### What was built

- `CacheUnavailableError` in `errors.ts`; `RedisStore` wraps every Upstash call in it and the client is configured with two quick retries (150 ms, 300 ms) so an outage costs about a second, not the SDK's default five-retry backoff.
- The route wrapper maps it to `503 budget_exhausted` with "Live search is unavailable right now. The example briefs still work." and logs `cache_down`. `toErrorResponse` does the same for any caller. The client shows the server's message as is and offers the example buttons, as it already did for that code.
- `/api/score` streams one `budget_exhausted` line per channel still waiting when Redis fails before or during scoring, then `done`, instead of breaking the stream. The scoring-cap read is skipped when every score was already cached, so an example never touches Redis.
- `/api/search` and `/api/status` still return a cached or precomputed result when Redis is down, reporting the new `budget: "unavailable"` state with `remaining: 0`; the banner reads "Live search is temporarily unavailable. The example briefs still work." `BudgetState` gained that value.
- `FailingStore` test double and `setCache()` for tests. New tests: live brief, search, score stream, and passcode fail closed with the friendly message and no external calls; the examples run end to end; status degrades but lists the examples; `RedisStore` wraps client errors. 26 files, 158 tests.
- README: the cache bullet states the fail-closed behaviour, and a Known limitations section lists the remaining six weaknesses with their trade-offs.

### Verification

- `npm run lint`, `npm run typecheck`, `npm test`: clean.
- Local, production build on port 3011 with `KV_REST_API_URL=https://127.0.0.1:9` (nothing listening): status answered in 668 ms with `budget: "unavailable"` and the examples listed; the Peak Fuel example ran fully cached in 591 ms; a fresh brief got `503 budget_exhausted` with the friendly message in about a second and no Gemini call; the passcode route got the same 503; the log shows `cache_down` and no spend lines.
- Commit `77fe374` pushed. Vercel deployment `6861669530` succeeded. Live, with Redis healthy: status `budget: "ok"`, the Terra Cookware example fully cached in 858 ms.
- Spent: 0 Gemini requests, 0 YouTube searches. Repository confirmed public at https://github.com/ahsanullahdaud/creator-match.
