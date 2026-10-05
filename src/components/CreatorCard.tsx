"use client";

import Image from "next/image";
import { formatCount } from "@/lib/format";
import type { Creator } from "@/lib/schemas";

interface Props {
  creator: Creator;
  rank: number;
  totalQueries: number;
}

/** One channel: identity, size, and the videos that matched. Scores arrive in step 8. */
export function CreatorCard({ creator, rank, totalQueries }: Props) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
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

      {creator.matchedVideos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {creator.matchedVideos.map((video) => (
            <li key={video.videoId} className="truncate text-sm">
              <a
                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-600 hover:underline dark:text-zinc-400"
              >
                {video.title || video.videoId}
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
