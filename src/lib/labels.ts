import type { z } from "zod";
import { CampaignGoal, Language, Region, SubscriberRange } from "./schemas";

/** Human labels for the dropdowns. The Record types keep them in sync with the enums. */
export const GOAL_LABELS: Record<z.infer<typeof CampaignGoal>, string> = {
  awareness: "Brand awareness",
  product_launch: "Product launch",
  conversions: "Sales or sign-ups",
  app_installs: "App installs",
  ugc: "UGC content",
};

export const SUBSCRIBER_RANGE_LABELS: Record<
  z.infer<typeof SubscriberRange>,
  string
> = {
  any: "Any size",
  "1k-10k": "1k to 10k subs",
  "10k-100k": "10k to 100k subs",
  "100k-1m": "100k to 1M subs",
  "1m-plus": "1M+ subs",
};

export const REGION_LABELS: Record<z.infer<typeof Region>, string> = {
  any: "Anywhere",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  IN: "India",
  PK: "Pakistan",
  DE: "Germany",
  FR: "France",
  BR: "Brazil",
};

export const LANGUAGE_LABELS: Record<z.infer<typeof Language>, string> = {
  any: "Any language",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  pt: "Portuguese",
  hi: "Hindi",
  ur: "Urdu",
};

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function toOptions<T extends string>(
  labels: Record<T, string>,
): Option<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({
    value,
    label: labels[value],
  }));
}
