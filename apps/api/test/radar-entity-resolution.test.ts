import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  canonicalLanguageCode,
  normalizeEntityLabel,
  resolveEventCandidate,
  resolveTopicCandidate,
  type EventProfile,
  type TopicAlias,
} from "../src/modules/radar/entity-resolution.js";

type Fixture = {
  topics: Record<"company" | "fruit" | "product", string>;
  events: Record<"launchDayOne" | "launchDayTwo" | "duplicateContext", string>;
  aliases: TopicAlias[];
  eventProfiles: EventProfile[];
};

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/radar/entity-resolution.json", import.meta.url), "utf8"),
) as Fixture;

describe("Radar topic normalization and alias resolution", () => {
  it("normalizes width, case and whitespace without deleting meaningful punctuation", () => {
    expect(normalizeEntityLabel("  ＭＡＩＮ\tTopic  ")).toBe("main topic");
    expect(normalizeEntityLabel("A-B")).toBe("a-b");
    expect(canonicalLanguageCode("ko-kr")).toBe("ko-KR");
    expect(() => normalizeEntityLabel("safe\u202Eevil")).toThrow("UNSAFE_ENTITY_LABEL");
  });

  it("returns ambiguous homonyms instead of forcing a same-string merge", () => {
    expect(
      resolveTopicCandidate(
        {
          label: "Main",
          languageCode: "en",
          source: "GOOGLE_TRENDING_RSS",
          observedAt: "2026-09-20T00:00:00Z",
        },
        fixture.aliases,
      ),
    ).toEqual({
      status: "AMBIGUOUS",
      entityIds: [fixture.topics.company, fixture.topics.fruit],
      basis: "VERIFIED_GLOBAL_ALIAS",
    });
  });

  it("uses a valid source-specific alias before a global alias, then honors expiry", () => {
    const base = {
      label: "애플",
      languageCode: "ko",
      source: "NAVER_SEARCH" as const,
    };
    expect(
      resolveTopicCandidate({ ...base, observedAt: "2026-09-20T00:00:00Z" }, fixture.aliases),
    ).toEqual({
      status: "MATCHED",
      entityId: fixture.topics.company,
      basis: "VERIFIED_SOURCE_ALIAS",
    });
    expect(
      resolveTopicCandidate({ ...base, observedAt: "2026-10-01T00:00:00Z" }, fixture.aliases),
    ).toEqual({
      status: "MATCHED",
      entityId: fixture.topics.fruit,
      basis: "VERIFIED_GLOBAL_ALIAS",
    });
  });

  it("does not use unverified aliases or cross language boundaries", () => {
    expect(
      resolveTopicCandidate(
        {
          label: "Apple Vision",
          languageCode: "en",
          source: "YOUTUBE_DATA_API",
          observedAt: "2026-09-20T00:00:00Z",
        },
        fixture.aliases,
      ),
    ).toMatchObject({ status: "UNRESOLVED", entityIds: [] });
    expect(
      resolveTopicCandidate(
        {
          label: "main",
          languageCode: "ko",
          source: "GOOGLE_TRENDING_RSS",
          observedAt: "2026-09-20T00:00:00Z",
        },
        fixture.aliases,
      ),
    ).toMatchObject({ status: "UNRESOLVED", entityIds: [] });
  });
});

describe("Radar topic/event separation", () => {
  const topicIds = [fixture.topics.company, fixture.topics.product];

  it("keeps the same topic and title on different days as separate events", () => {
    expect(
      resolveEventCandidate(
        {
          title: "신제품 공개",
          languageCode: "ko",
          source: "GOOGLE_TRENDING_RSS",
          sourceItemId: "google-day-two",
          topicIds,
          occurredAt: "2026-09-20T01:00:00Z",
          timePrecision: "EXACT",
        },
        fixture.eventProfiles.slice(0, 2),
      ),
    ).toEqual({
      status: "MATCHED",
      entityId: fixture.events.launchDayTwo,
      basis: "EXACT_TITLE_TOPICS_AND_TIME",
    });
  });

  it("uses a stable provider reference even when the event time is unknown", () => {
    expect(
      resolveEventCandidate(
        {
          title: "후속 기사 제목",
          languageCode: "ko",
          source: "NAVER_SEARCH",
          sourceItemId: "naver-launch-1",
          topicIds,
          occurredAt: null,
          timePrecision: "UNKNOWN",
        },
        fixture.eventProfiles,
      ),
    ).toEqual({
      status: "MATCHED",
      entityId: fixture.events.launchDayOne,
      basis: "EXACT_SOURCE_REFERENCE",
    });
  });

  it("does not cross-source merge unknown-time events", () => {
    expect(
      resolveEventCandidate(
        {
          title: "신제품 공개",
          languageCode: "ko",
          source: "GOOGLE_TRENDING_RSS",
          sourceItemId: "unknown-time",
          topicIds,
          occurredAt: null,
          timePrecision: "UNKNOWN",
        },
        fixture.eventProfiles,
      ),
    ).toMatchObject({ status: "UNRESOLVED", entityIds: [] });
  });

  it("returns ambiguity when identical context points to multiple event IDs", () => {
    expect(
      resolveEventCandidate(
        {
          title: "신제품 공개",
          languageCode: "ko",
          source: "GOOGLE_TRENDING_RSS",
          sourceItemId: "ambiguous-day-one",
          topicIds,
          occurredAt: "2026-09-19T01:00:00Z",
          timePrecision: "EXACT",
        },
        fixture.eventProfiles,
      ),
    ).toEqual({
      status: "AMBIGUOUS",
      entityIds: [fixture.events.launchDayOne, fixture.events.duplicateContext],
      basis: "EXACT_TITLE_TOPICS_AND_TIME",
    });
  });

  it("rejects duplicate topic identity in a candidate", () => {
    expect(() =>
      resolveEventCandidate(
        {
          title: "신제품 공개",
          languageCode: "ko",
          source: "GOOGLE_TRENDING_RSS",
          sourceItemId: "duplicate-topic",
          topicIds: [fixture.topics.company, fixture.topics.company],
          occurredAt: "2026-09-19T01:00:00Z",
          timePrecision: "EXACT",
        },
        fixture.eventProfiles,
      ),
    ).toThrow("DUPLICATE_EVENT_TOPIC");
  });
});
