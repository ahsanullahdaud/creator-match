"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ExampleButtons } from "./ExampleButtons";
import type { ExampleBrief } from "@/lib/example-briefs";
import {
  GOAL_LABELS,
  LANGUAGE_LABELS,
  REGION_LABELS,
  SUBSCRIBER_RANGE_LABELS,
  toOptions,
  type Option,
} from "@/lib/labels";
import { Brief } from "@/lib/schemas";

export type BriefSource = "form" | "example";

export const EMPTY_BRIEF: Brief = {
  brandName: "",
  product: "",
  audience: "",
  goal: "awareness",
  subscriberRange: "10k-100k",
  region: "any",
  language: "en",
  notes: "",
};

type Errors = Partial<Record<keyof Brief, string>>;

interface Props {
  examples: readonly ExampleBrief[];
  onValid: (brief: Brief, source: BriefSource) => void;
  busy?: boolean;
}

const GOAL_OPTIONS = toOptions(GOAL_LABELS);
const RANGE_OPTIONS = toOptions(SUBSCRIBER_RANGE_LABELS);
const REGION_OPTIONS = toOptions(REGION_LABELS);
const LANGUAGE_OPTIONS = toOptions(LANGUAGE_LABELS);

const fieldClass =
  "w-full rounded-lg border bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:ring-2 disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-100";
const okClass =
  "border-zinc-300 focus:border-zinc-900 focus:ring-zinc-900/10 dark:border-zinc-700 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20";
const badClass =
  "border-red-500 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500";

interface IssueLike {
  code: string;
  message: string;
  minimum?: unknown;
  maximum?: unknown;
}

/** Turns Zod messages into what a person filling in a form expects to read. */
function friendlyMessage(issue: IssueLike, value: string): string {
  if (issue.code === "too_small") {
    return value.trim() === ""
      ? "Required"
      : `Too short, at least ${String(issue.minimum)} characters`;
  }
  if (issue.code === "too_big") {
    return `Too long, keep it under ${String(issue.maximum)} characters`;
  }
  return issue.message;
}

export function BriefForm({ examples, onValid, busy = false }: Props) {
  const [values, setValues] = useState<Brief>(EMPTY_BRIEF);
  const [errors, setErrors] = useState<Errors>({});
  const prefix = useId();
  const id = (field: keyof Brief) => `${prefix}-${field}`;

  function update<K extends keyof Brief>(field: K, value: Brief[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function validate(candidate: Brief, source: BriefSource) {
    const result = Brief.safeParse(candidate);
    if (!result.success) {
      const next: Errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key !== "string" || key in next) continue;
        const field = key as keyof Brief;
        next[field] = friendlyMessage(issue, String(candidate[field] ?? ""));
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onValid(result.data, source);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    validate(values, "form");
  }

  function pickExample(example: ExampleBrief) {
    setValues(example.brief);
    validate(example.brief, "example");
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-busy={busy}
    >
      <ExampleButtons
        examples={examples}
        onPick={pickExample}
        disabled={busy}
      />

      <Field id={id("brandName")} label="Brand name" error={errors.brandName}>
        <input
          id={id("brandName")}
          name="brandName"
          type="text"
          autoComplete="organization"
          placeholder="Peak Fuel"
          value={values.brandName}
          onChange={(e) => update("brandName", e.target.value)}
          disabled={busy}
          aria-invalid={Boolean(errors.brandName)}
          className={`${fieldClass} ${errors.brandName ? badClass : okClass} sm:max-w-sm`}
        />
      </Field>

      <Field
        id={id("product")}
        label="Product or offer"
        error={errors.product}
        hint="What you are promoting, in one line."
      >
        <input
          id={id("product")}
          name="product"
          type="text"
          placeholder="Electrolyte drink mix for long-distance runners"
          value={values.product}
          onChange={(e) => update("product", e.target.value)}
          disabled={busy}
          aria-invalid={Boolean(errors.product)}
          className={`${fieldClass} ${errors.product ? badClass : okClass}`}
        />
      </Field>

      <Field
        id={id("audience")}
        label="Target audience"
        error={errors.audience}
        hint="Who should see it."
      >
        <input
          id={id("audience")}
          name="audience"
          type="text"
          placeholder="Amateur marathon and half-marathon runners"
          value={values.audience}
          onChange={(e) => update("audience", e.target.value)}
          disabled={busy}
          aria-invalid={Boolean(errors.audience)}
          className={`${fieldClass} ${errors.audience ? badClass : okClass}`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SelectField
          id={id("goal")}
          name="goal"
          label="Goal"
          value={values.goal}
          options={GOAL_OPTIONS}
          onChange={(v) => update("goal", v)}
          disabled={busy}
        />
        <SelectField
          id={id("subscriberRange")}
          name="subscriberRange"
          label="Channel size"
          value={values.subscriberRange}
          options={RANGE_OPTIONS}
          onChange={(v) => update("subscriberRange", v)}
          disabled={busy}
        />
        <SelectField
          id={id("region")}
          name="region"
          label="Region"
          value={values.region}
          options={REGION_OPTIONS}
          onChange={(v) => update("region", v)}
          disabled={busy}
        />
        <SelectField
          id={id("language")}
          name="language"
          label="Language"
          value={values.language}
          options={LANGUAGE_OPTIONS}
          onChange={(v) => update("language", v)}
          disabled={busy}
        />
      </div>

      <Field id={id("notes")} label="Notes" error={errors.notes} optional>
        <textarea
          id={id("notes")}
          name="notes"
          rows={2}
          placeholder="Anything the creator should or should not be, tone, budget hints"
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
          disabled={busy}
          aria-invalid={Boolean(errors.notes)}
          className={`${fieldClass} ${errors.notes ? badClass : okClass} resize-y`}
        />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-base font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {busy ? "Working" : "Find creators"}
        </button>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Three fields are enough. The rest have sensible defaults.
        </p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
      >
        {label}
        {optional && (
          <span className="ml-1 font-normal text-zinc-500">(optional)</span>
        )}
      </label>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

function SelectField<T extends string>({
  id,
  name,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
      >
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        disabled={disabled}
        className={`${fieldClass} ${okClass}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
