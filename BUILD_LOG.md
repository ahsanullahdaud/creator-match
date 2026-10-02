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
