import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { RANKING_VERSION } from "../src/modules/recommendations/contracts.js";
import {
  decodeIssueFeedCursor,
  encodeIssueFeedCursor,
  encodePersonalizedIssueFeedCursor,
} from "../src/modules/issues/cursor.js";

describe("refresh-diverse Issue Feed cursor", () => {
  it("round-trips the discovery seed and full ranking key", () => {
    const rankingSeed = randomUUID();
    const issueId = randomUUID();
    const publishedAt = new Date("2026-08-25T09:00:00.000Z");

    const decoded = decodeIssueFeedCursor(
      encodeIssueFeedCursor({
        mode: "RECENCY",
        rankingVersion: RANKING_VERSION,
        rankingSeed,
        score: 87,
        publishedAt,
        issueId,
      }),
    );

    expect(decoded).toEqual({
      mode: "RECENCY",
      rankingVersion: RANKING_VERSION,
      rankingSeed,
      score: 87,
      publishedAt,
      issueId,
    });
  });

  it("round-trips the personalized refresh seed", () => {
    const rankingSeed = randomUUID();
    const issueId = randomUUID();
    const publishedAt = new Date("2026-08-25T09:00:00.000Z");

    expect(
      decodeIssueFeedCursor(
        encodePersonalizedIssueFeedCursor({
          mode: "PERSONALIZED",
          rankingVersion: RANKING_VERSION,
          rankingSeed,
          profileVersion: 3,
          score: 1_004,
          publishedAt,
          issueId,
        }),
      ),
    ).toMatchObject({ rankingSeed, profileVersion: 3, score: 1_004 });
  });

  it("keeps legacy recency cursors readable during deployment transition", () => {
    const issueId = randomUUID();
    const publishedAt = new Date("2026-08-25T09:00:00.000Z");
    const legacy = Buffer.from(
      JSON.stringify({ publishedAt: publishedAt.toISOString(), issueId }),
    ).toString("base64url");

    expect(decodeIssueFeedCursor(legacy)).toEqual({ mode: "RECENCY", publishedAt, issueId });
  });
});
