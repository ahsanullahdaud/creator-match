"use client";

import { CreatorCard } from "./CreatorCard";
import type { Creator } from "@/lib/schemas";

interface Props {
  creators: Creator[];
  totalQueries: number;
}

export function CreatorGrid({ creators, totalQueries }: Props) {
  if (creators.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        No channels in the chosen size range matched these searches. Try
        &ldquo;Any size&rdquo; or a different region.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {creators.map((creator, index) => (
        <CreatorCard
          key={creator.channelId}
          creator={creator}
          rank={index + 1}
          totalQueries={totalQueries}
        />
      ))}
    </ul>
  );
}
