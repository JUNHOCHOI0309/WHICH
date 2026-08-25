import { RANKING_VERSION } from "../recommendations/contracts.js";
import { IssueReadError } from "./errors.js";

type LegacyRecencyIssueFeedCursor = {
  mode: "RECENCY";
  rankingVersion?: undefined;
  rankingSeed?: undefined;
  score?: undefined;
  publishedAt: Date;
  issueId: string;
};

type DiversifiedRecencyIssueFeedCursor = {
  mode: "RECENCY";
  rankingVersion: typeof RANKING_VERSION;
  rankingSeed: string;
  score: number;
  publishedAt: Date;
  issueId: string;
};

export type RecencyIssueFeedCursor =
  LegacyRecencyIssueFeedCursor | DiversifiedRecencyIssueFeedCursor;

export type PersonalizedIssueFeedCursor = {
  mode: "PERSONALIZED";
  rankingVersion: typeof RANKING_VERSION;
  rankingSeed: string;
  profileVersion: number;
  score: number;
  publishedAt: Date;
  issueId: string;
};

export type IssueFeedCursor = RecencyIssueFeedCursor | PersonalizedIssueFeedCursor;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeIssueFeedCursor(cursor: RecencyIssueFeedCursor) {
  return Buffer.from(
    JSON.stringify({
      ...(cursor.rankingSeed
        ? {
            mode: cursor.mode,
            rankingVersion: cursor.rankingVersion,
            rankingSeed: cursor.rankingSeed,
            score: cursor.score,
          }
        : {}),
      publishedAt: cursor.publishedAt.toISOString(),
      issueId: cursor.issueId,
    }),
  ).toString("base64url");
}

export function encodePersonalizedIssueFeedCursor(cursor: PersonalizedIssueFeedCursor) {
  return Buffer.from(
    JSON.stringify({
      mode: cursor.mode,
      rankingVersion: cursor.rankingVersion,
      rankingSeed: cursor.rankingSeed,
      profileVersion: cursor.profileVersion,
      score: cursor.score,
      publishedAt: cursor.publishedAt.toISOString(),
      issueId: cursor.issueId,
    }),
  ).toString("base64url");
}

export function decodeIssueFeedCursor(value: string): IssueFeedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      mode?: unknown;
      rankingVersion?: unknown;
      rankingSeed?: unknown;
      profileVersion?: unknown;
      score?: unknown;
      publishedAt?: unknown;
      issueId?: unknown;
    };
    const publishedAt = new Date(String(parsed.publishedAt));

    if (
      typeof parsed.publishedAt !== "string" ||
      Number.isNaN(publishedAt.valueOf()) ||
      typeof parsed.issueId !== "string" ||
      !uuidPattern.test(parsed.issueId)
    ) {
      throw new Error("Invalid cursor payload");
    }

    if (parsed.mode === "PERSONALIZED") {
      if (
        parsed.rankingVersion !== RANKING_VERSION ||
        typeof parsed.rankingSeed !== "string" ||
        !uuidPattern.test(parsed.rankingSeed) ||
        typeof parsed.profileVersion !== "number" ||
        !Number.isInteger(parsed.profileVersion) ||
        parsed.profileVersion < 1 ||
        typeof parsed.score !== "number" ||
        !Number.isInteger(parsed.score) ||
        parsed.score < 0
      ) {
        throw new Error("Invalid personalized cursor payload");
      }
      return {
        mode: "PERSONALIZED",
        rankingVersion: RANKING_VERSION,
        rankingSeed: parsed.rankingSeed,
        profileVersion: parsed.profileVersion,
        score: parsed.score,
        publishedAt,
        issueId: parsed.issueId,
      };
    }

    if (parsed.mode === "RECENCY") {
      if (
        parsed.rankingVersion !== RANKING_VERSION ||
        typeof parsed.rankingSeed !== "string" ||
        !uuidPattern.test(parsed.rankingSeed) ||
        typeof parsed.score !== "number" ||
        !Number.isInteger(parsed.score) ||
        parsed.score < 0
      ) {
        throw new Error("Invalid diversified cursor payload");
      }
      return {
        mode: "RECENCY",
        rankingVersion: RANKING_VERSION,
        rankingSeed: parsed.rankingSeed,
        score: parsed.score,
        publishedAt,
        issueId: parsed.issueId,
      };
    }

    return { mode: "RECENCY", publishedAt, issueId: parsed.issueId };
  } catch {
    throw new IssueReadError("INVALID_CURSOR", 400, "The Issue feed cursor is invalid.");
  }
}
