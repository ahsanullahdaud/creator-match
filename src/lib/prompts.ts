import {
  GOAL_LABELS,
  LANGUAGE_LABELS,
  REGION_LABELS,
  SUBSCRIBER_RANGE_LABELS,
} from "./labels";
import type { Brief, Creator, QueryPlan } from "./schemas";

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

export const SCORE_SYSTEM_PROMPT = `You evaluate YouTube channels as sponsorship partners for a brand. For each channel you get public stats and the titles of the videos that matched the brand's search queries.

Scoring, fitScore 0 to 100:
- 80 and above only when the audience is clearly the brief audience and the product category already appears naturally in the content.
- 60 to 79 when the audience overlaps and a sponsorship would feel natural with a little framing.
- 40 to 59 when the overlap is partial or the content format would make the product feel forced.
- Below 40 when the audience, language, region or format is wrong, or the channel looks inactive or competitor-owned.
verdict: strong for 75 and above, possible for 50 to 74, weak below 50.

Rules:
- Weigh audience match far above channel size. Treat old matched videos as a sign of inactivity.
- reasons: 2 to 4 short sentences that cite the data you were given (video titles, counts, dates). Never invent facts about the channel.
- concerns: 0 to 3 short sentences; leave the list empty when there is nothing real to flag.
- audienceOverlap: one sentence on who watches this channel versus the brief audience.
- outreach.angle: one concrete collaboration idea tied to a matched video or the channel's usual format.
- outreach.subjectLine: at most 8 words, specific, no clickbait.
- outreach.openingMessage: under 120 words, first person from the brand, warm and specific, plain text, no placeholders such as [Name], no hype.
Return exactly one entry per channel, using the channelId exactly as given. Return only JSON that matches the schema.`;

export function scorePrompt(
  brief: Brief,
  plan: QueryPlan,
  creators: Creator[],
  today: Date = new Date(),
): string {
  const candidates = creators.map((c) => ({
    channelId: c.channelId,
    title: c.title,
    handle: c.handle,
    country: c.country,
    subscribers: c.subscriberCount,
    videos: c.videoCount,
    totalViews: c.viewCount,
    matchedSearches: c.hits,
    description: c.description.slice(0, 300),
    matchedVideos: c.matchedVideos.map((v) => ({
      title: v.title,
      published: v.publishedAt.slice(0, 10),
    })),
  }));
  return [
    queryPrompt(brief),
    `Today: ${today.toISOString().slice(0, 10)}`,
    `Content themes expected: ${plan.contentThemes.join(", ") || "none given"}`,
    `Poor-fit signals: ${plan.avoid.join(", ") || "none given"}`,
    "",
    `Channels to score (${creators.length}):`,
    JSON.stringify(candidates),
  ].join("\n");
}
