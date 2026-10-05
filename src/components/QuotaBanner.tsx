"use client";

import type { BudgetState, VisitorStatus } from "@/lib/schemas";

interface Props {
  visitor: VisitorStatus | null;
  budget: BudgetState | null;
}

type Tone = "info" | "warn" | "stop";

const toneClass: Record<Tone, string> = {
  info: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  stop: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
};

function message(
  visitor: VisitorStatus | null,
  budget: BudgetState | null,
): {
  tone: Tone;
  text: string;
} | null {
  if (budget === "exhausted") {
    return {
      tone: "stop",
      text: "Today's live search budget is used up for everyone. The example briefs still work, and the budget resets at midnight Pacific.",
    };
  }
  if (!visitor) return null;
  if (visitor.bypass) {
    return {
      tone: "info",
      text: "Passcode active: no per-visitor search limit.",
    };
  }
  if (visitor.remaining <= 0) {
    return {
      tone: "warn",
      text: `You have used your ${visitor.limit} live searches for today. Example briefs and briefs seen before still work.`,
    };
  }
  const left = `${visitor.remaining} of ${visitor.limit} live searches left today.`;
  if (budget === "low") {
    return { tone: "warn", text: `${left} Only a few remain for everyone.` };
  }
  return { tone: "info", text: `${left} Example briefs are free.` };
}

/** One line about what the visitor can still do today. */
export function QuotaBanner({ visitor, budget }: Props) {
  const m = message(visitor, budget);
  if (!m) return null;
  return (
    <p
      role={m.tone === "info" ? undefined : "status"}
      className={`rounded-xl border px-4 py-2.5 text-sm ${toneClass[m.tone]}`}
    >
      {m.text}
    </p>
  );
}
