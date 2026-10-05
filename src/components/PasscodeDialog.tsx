"use client";

import { useId, useState, type FormEvent } from "react";
import type { ErrorResponse } from "@/lib/schemas";

interface Props {
  /** Whether the current visitor already holds the bypass cookie. */
  active: boolean;
  /** Called after the cookie changes, so the page can refresh its status. */
  onChange: () => void;
}

/** A small footer control: enter the demo passcode, or turn it off again. */
export function PasscodeDialog({ active, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/passcode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: value }),
      });
      if (res.ok) {
        setValue("");
        setOpen(false);
        onChange();
      } else {
        const body = (await res.json()) as ErrorResponse;
        setError(body.error?.message ?? "That passcode is not right.");
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await fetch("/api/passcode", { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const linkClass =
    "text-xs text-zinc-500 underline-offset-2 hover:underline disabled:opacity-50";

  if (active) {
    return (
      <p className="text-xs text-zinc-500">
        Passcode active.{" "}
        <button
          type="button"
          onClick={turnOff}
          disabled={busy}
          className={linkClass}
        >
          Turn off
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={linkClass}>
        Have a passcode?
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Passcode
      </label>
      <input
        id={id}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        placeholder="Passcode"
        className="w-40 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <button
        type="submit"
        disabled={busy || value.trim() === ""}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Unlock
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className={linkClass}
      >
        Cancel
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </form>
  );
}
