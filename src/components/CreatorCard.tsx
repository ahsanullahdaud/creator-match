"use client";

import Image from "next/image";
import { OutreachPanel } from "./OutreachPanel";
import type { ScoreStatus } from "@/hooks/useMatchPipeline";
import { decodeHtml, formatCount } from "@/lib/format";
import type { Creator, CreatorScore } from "@/lib/schemas";

interface Props {
  creator: Creator;
  rank: number;
  totalQueries: number;
  score?: ScoreStatus;
  onRetry?: (channelId: string) => void;
}

const verdictClass: Record<CreatorScore["verdict"], string> = {
  strong:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  possible:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  weak: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const verdictLabel: Record<CreatorScore["verdict"], string> = {
  strong: "Strong fit",
  possible: "Possible fit",
  weak: "Weak fit",
};

function ScoreArea({
  channelId,
  score,
  onRetry,
}: {
  channelId: string;
  score?: ScoreStatus;
  onRetry?: (channelId: string) => void;
}) {
  if (!score || score.status === "pending") {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <div className="h-6 w-28 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <p className="text-xs text-zinc-500">Scoring fit</p>
      </div>
    );
  }
  if (score.status === "error") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        <p>{score.error.message}</p>
        {score.error.retryable && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(channelId)}
            className="self-start rounded-md border border-red-300 px-2 py-0.5 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  const { score: s } = score;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${verdictClass[s.verdict]}`}
        >
          {s.fitScore}
          <span className="font-normal">{verdictLabel[s.verdict]}</span>
        </span>
        {score.cached && <span className="text-xs text-zinc-400">cached</span>}
      </div>
      <ul className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
        {s.reasons.map((reason) => (
          <li key={reason} className="flex gap-1.5">
            <span aria-hidden className="text-emerald-600">
              +
            </span>
            <span className="min-w-0 break-words">{reason}</span>
          </li>
        ))}
        {s.concerns.map((concern) => (
          <li key={concern} className="flex gap-1.5 text-zinc-500">
            <span aria-hidden className="text-amber-600">
              !
            </span>
            <span className="min-w-0 break-words">{concern}</span>
          </li>
        ))}
      </ul>
      <p className="break-words text-xs text-zinc-500">{s.audienceOverlap}</p>
      <OutreachPanel outreach={s.outreach} />
    </div>
  );
}

/** One channel: identity, size, matched videos, and its fit score once scored. */
export function CreatorCard({
  creator,
  rank,
  totalQueries,
  score,
  onRetry,
}: Props) {
  return (
    <li className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-3">
        <Image
          src={creator.thumbnailUrl}
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 shrink-0 rounded-full bg-zinc-100 object-cover dark:bg-zinc-800"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-zinc-400">#{rank}</span>
            <a
              href={creator.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-base font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
            >
              {creator.title}
            </a>
          </div>
          <p className="truncate text-sm text-zinc-500">
            {creator.handle ?? creator.channelId}
          </p>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            {formatCount(creator.subscriberCount)} subscribers ·{" "}
            {formatCount(creator.videoCount)} videos
            {creator.country ? ` · ${creator.country}` : ""}
          </p>
        </div>
      </div>

      <ScoreArea
        channelId={creator.channelId}
        score={score}
        onRetry={onRetry}
      />

      {creator.matchedVideos.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-900">
          {creator.matchedVideos.map((video) => (
            <li key={video.videoId} className="min-w-0 text-sm">
              <a
                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-zinc-600 hover:underline dark:text-zinc-400"
              >
                {video.title ? decodeHtml(video.title) : video.videoId}
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-zinc-500">
        Matched {creator.hits} of {totalQueries} searches
      </p>
    </li>
  );
}
