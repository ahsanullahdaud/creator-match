import { pacificDate, utcDate } from "./hash";

/** Every cache key in one place. TTLs live in config.ts, the table in PLAN.md. */
export const keys = {
  brief: (briefId: string) => `brief:${briefId}`,
  search: (briefId: string) => `search:${briefId}`,
  score: (briefId: string, channelId: string) =>
    `score:${briefId}:${channelId}`,
  scoreCount: (briefId: string) => `scorecount:${briefId}`,
  ytSearch: (queryHash: string) => `yt:search:${queryHash}`,
  ytChannel: (channelId: string) => `yt:channel:${channelId}`,
  ytSearches: (now?: Date) => `yt:searches:${pacificDate(now)}`,
  ytUnits: (now?: Date) => `yt:units:${pacificDate(now)}`,
  llmRequests: (now?: Date) => `llm:requests:${pacificDate(now)}`,
  rlSearch: (ipHash: string, now?: Date) =>
    `rl:search:${ipHash}:${utcDate(now)}`,
  rlBrief: (ipHash: string, now?: Date) => `rl:brief:${ipHash}:${utcDate(now)}`,
} as const;
