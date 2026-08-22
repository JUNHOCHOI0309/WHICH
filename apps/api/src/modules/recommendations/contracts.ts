import type { InterestCardCode } from "../interests/contracts.js";

export const RANKING_VERSION = "interest_content_v1";

export type RankingMode = "PERSONALIZED" | "RECENCY";
export type RankingReasonCode =
  | "INTEREST_PROFILE_MATCH"
  | "PROFILE_NOT_READY"
  | "FEATURE_DISABLED"
  | "IDENTITY_UNAVAILABLE"
  | "RANKER_FALLBACK";

export type FeedRankingContext = {
  requestId: string;
  version: typeof RANKING_VERSION;
  mode: RankingMode;
  reasonCode: RankingReasonCode;
  profileVersion: number | null;
};

export type FeedItemRecommendation = {
  score: number;
  reasonCodes: Array<"INTEREST_MATCH" | "EXPLORATION" | "RECENT_FALLBACK">;
  matchedCardCodes: InterestCardCode[];
};

export type RankingProfile = {
  subjectId: string | null;
  profileVersion: number | null;
  selectedCardCodes: InterestCardCode[];
  mode: RankingMode;
  reasonCode: RankingReasonCode;
};

export type RankableIssue = {
  id: string;
  version: number;
  publishedAt: Date;
  cardWeights: Map<InterestCardCode, number>;
};

export type RankedIssue = RankableIssue & FeedItemRecommendation & { explorationScore: number };
