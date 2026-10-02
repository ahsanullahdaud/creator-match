# Creator Match

Paste a brand brief, get a ranked shortlist of YouTube creators with a fit score and a draft outreach angle for each.

How it works: Claude turns the brief into YouTube search queries, the YouTube Data API returns matching videos and their channels, then Claude scores each channel against the brief and drafts the first message. Results are cached so repeated briefs cost nothing, and live searches are rate limited because the YouTube quota is small.

Live: https://creator-match-seven.vercel.app (placeholder page until the brief form lands in step 5).

Status: in progress. `PLAN.md` has the design and build order, `BUILD_LOG.md` records each step.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY and YOUTUBE_API_KEY
npm run dev                  # http://localhost:3000
```

Checks:

```bash
npm run lint
npm run typecheck
npm test
```

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, Zod, Anthropic SDK, YouTube Data API v3, Upstash Redis, Vitest. Deployed on Vercel.
