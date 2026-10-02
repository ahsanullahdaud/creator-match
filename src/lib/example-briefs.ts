import { Brief } from "./schemas";

export interface ExampleBrief {
  slug: string;
  title: string;
  blurb: string;
  brief: Brief;
}

/** Fictional brands. Step 11 precomputes full results for exactly these briefs. */
export const EXAMPLE_BRIEFS: readonly ExampleBrief[] = [
  {
    slug: "peak-fuel",
    title: "Peak Fuel",
    blurb: "Electrolyte mix for marathon runners. US, awareness.",
    brief: Brief.parse({
      brandName: "Peak Fuel",
      product: "Electrolyte drink mix for long-distance runners",
      audience: "Amateur marathon and half-marathon runners",
      goal: "awareness",
      subscriberRange: "10k-100k",
      region: "US",
      language: "en",
    }),
  },
  {
    slug: "loomnotes",
    title: "LoomNotes",
    blurb: "AI note-taking app for students. App installs.",
    brief: Brief.parse({
      brandName: "LoomNotes",
      product: "AI note-taking app that turns lectures into summaries",
      audience: "University students juggling lectures and exams",
      goal: "app_installs",
      subscriberRange: "10k-100k",
      region: "any",
      language: "en",
    }),
  },
  {
    slug: "terra-cookware",
    title: "Terra Cookware",
    blurb: "Ceramic pans for weeknight batch cooking. UK, sales.",
    brief: Brief.parse({
      brandName: "Terra Cookware",
      product: "Ceramic non-stick pans for weeknight batch cooking",
      audience: "Home cooks who meal-prep on Sundays",
      goal: "conversions",
      subscriberRange: "100k-1m",
      region: "GB",
      language: "en",
    }),
  },
];
