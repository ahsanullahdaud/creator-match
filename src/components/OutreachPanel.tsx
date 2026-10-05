"use client";

import { useState } from "react";
import type { CreatorScore } from "@/lib/schemas";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable, e.g. insecure context */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** The outreach draft for one creator: angle, subject line, first message. */
export function OutreachPanel({
  outreach,
}: {
  outreach: CreatorScore["outreach"];
}) {
  return (
    <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Outreach draft
      </summary>
      <div className="flex flex-col gap-3 border-t border-zinc-200 px-3 py-3 text-sm dark:border-zinc-800">
        <p className="text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Angle:{" "}
          </span>
          {outreach.angle}
        </p>
        <div className="flex items-start justify-between gap-2">
          <p className="text-zinc-700 dark:text-zinc-300">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              Subject:{" "}
            </span>
            {outreach.subjectLine}
          </p>
          <CopyButton text={outreach.subjectLine} label="Copy" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {outreach.openingMessage}
          </p>
          <div>
            <CopyButton text={outreach.openingMessage} label="Copy message" />
          </div>
        </div>
      </div>
    </details>
  );
}
