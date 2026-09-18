import { describe, expect, it } from "vitest";
import { normalizePollRow, pollDraftSchema } from "../src/modules/operations/poll-candidates.js";
import { POLL_CHANNEL_REGISTER } from "../src/modules/operations/poll-channels.js";

const row = {
  channel: "캠핑한끼 CampingHankki",
  originalQuestion: "어디서 먹을까요?",
  originalChoices: ["집", "산", "바다", "공원"],
  sourceUrl: "https://www.youtube.com/post/Ugkx1234567890?si=tracking",
};
describe("poll source validation", () => {
  it("keeps handoff channel readiness separate from live collection", () => {
    expect(POLL_CHANNEL_REGISTER).toHaveLength(12);
    expect(POLL_CHANNEL_REGISTER.filter((channel) => channel.initialBatchEligible)).toHaveLength(
      11,
    );
    expect(POLL_CHANNEL_REGISTER.find((channel) => channel.name === "만렙백수")).toMatchObject({
      initialBatchEligible: false,
      identityNeedsConfirmation: true,
    });
    expect(POLL_CHANNEL_REGISTER.every((channel) => !channel.liveCollectionVerified)).toBe(true);
  });
  it("retains all source choices and canonicalizes channel names and post links", () => {
    expect(normalizePollRow(row)).toMatchObject({
      ...row,
      channel: "캠핑한끼CampingHankki",
      sourceUrl: "https://www.youtube.com/post/Ugkx1234567890",
      postId: "Ugkx1234567890",
    });
    expect(
      normalizePollRow({
        ...row,
        sourceUrl: "https://www.youtube.com/@example/community?lb=Ugkx1234567890",
      }).postId,
    ).toBe("Ugkx1234567890");
  });
  it.each([
    "https://evil.example/post/Ugkx1234567890",
    "http://www.youtube.com/post/Ugkx1234567890",
    "https://www.youtube.com/@example/posts",
    "https://www.youtube.com/watch?v=1234567890",
  ])("rejects a non-post source: %s", (sourceUrl) => {
    expect(() => normalizePollRow({ ...row, sourceUrl })).toThrow();
  });
  it("rejects unknown channels and never truncates a six-choice source", () => {
    expect(() => normalizePollRow({ ...row, channel: "unknown" })).toThrow();
    expect(
      normalizePollRow({ ...row, originalChoices: ["1", "2", "3", "4", "5", "6"] }).originalChoices,
    ).toHaveLength(6);
    expect(
      pollDraftSchema.safeParse({
        question: "질문",
        context: "설명",
        choices: ["1", "2", "3", "4", "5"],
        interestCardCode: "DAILY_LIFE",
      }).success,
    ).toBe(false);
  });
});
