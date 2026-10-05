import {
  GOAL_LABELS,
  LANGUAGE_LABELS,
  REGION_LABELS,
  SUBSCRIBER_RANGE_LABELS,
} from "./labels";
import type { Brief } from "./schemas";

export const QUERY_SYSTEM_PROMPT = `You find YouTube creators for brand collaborations. Given a brand brief, write the YouTube search queries a marketer would run to find channels whose viewers match the brief audience.

Rules:
- Each query is what a viewer would type into YouTube search: 2 to 6 plain words, no brand names, no quotes, no search operators.
- Exactly 3 queries, each from a different angle: the core topic, the lifestyle or goal of the audience, and an adjacent interest that audience shares.
- Write queries in the language of the brief. Let the region shape the wording only where it changes what people search for.
- contentThemes: up to 5 short themes a well-matched channel covers.
- avoid: up to 3 signals that a channel is a poor fit, such as the wrong audience, the wrong format, or a competitor-owned channel.
Return only JSON that matches the schema.`;

export function queryPrompt(brief: Brief): string {
  const lines = [
    `Brand: ${brief.brandName}`,
    `Product or offer: ${brief.product}`,
    `Target audience: ${brief.audience}`,
    `Campaign goal: ${GOAL_LABELS[brief.goal]}`,
    `Preferred channel size: ${SUBSCRIBER_RANGE_LABELS[brief.subscriberRange]}`,
    `Region: ${REGION_LABELS[brief.region]}`,
    `Language: ${LANGUAGE_LABELS[brief.language]}`,
  ];
  if (brief.notes) lines.push(`Notes from the brand: ${brief.notes}`);
  return lines.join("\n");
}

export const REASK_SUFFIX =
  "Your previous answer was not valid for the schema. Reply again with only the JSON object: no prose, no code fences.";
