import { describe, expect, it } from "vitest";
import {
  GOAL_LABELS,
  LANGUAGE_LABELS,
  REGION_LABELS,
  SUBSCRIBER_RANGE_LABELS,
  toOptions,
} from "@/lib/labels";
import { CampaignGoal, Language, Region, SubscriberRange } from "@/lib/schemas";

describe("labels", () => {
  it("cover every enum value and nothing else", () => {
    expect(Object.keys(GOAL_LABELS).sort()).toEqual(
      [...CampaignGoal.options].sort(),
    );
    expect(Object.keys(SUBSCRIBER_RANGE_LABELS).sort()).toEqual(
      [...SubscriberRange.options].sort(),
    );
    expect(Object.keys(REGION_LABELS).sort()).toEqual(
      [...Region.options].sort(),
    );
    expect(Object.keys(LANGUAGE_LABELS).sort()).toEqual(
      [...Language.options].sort(),
    );
  });

  it("toOptions keeps declaration order and pairs values with labels", () => {
    const options = toOptions(GOAL_LABELS);
    expect(options[0]).toEqual({
      value: "awareness",
      label: "Brand awareness",
    });
    expect(options.map((o) => o.value)).toEqual(Object.keys(GOAL_LABELS));
  });
});
