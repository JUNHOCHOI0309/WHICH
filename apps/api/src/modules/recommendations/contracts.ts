import type { InterestCardCode } from "../interests/contracts.js";

export const RANKING_VERSION = "quality_feed_v1";
export const QUALITY_RANKING_POLICY_VERSION = "quality-feed-v1.0";

export type QualityRankerMode = "OFF" | "SHADOW" | "LIVE";
export type CandidateSource =
  | "INTEREST"
  | "FRESH"
  | "EDITORIAL_QUALITY"
  | "BEHAVIOR_QUALITY"
  | "EXPLORATION"
  | "DEFAULT_FALLBACK";

export type QualityScoreComponents = {
  interest: number;
  freshness: number;
  editorial: number;
  behavior: number;
  exploration: number;
  safetyPenalty: number;
};

export type IssueQualitySignals = {
  viewableImpressions: number;
  acceptedA: number;
  acceptedB: number;
  acceptedC: number;
  acceptedD: number;
  averageDecisionMs: number | null;
  nextIssueOpens: number;
  commentCompletions: number;
  shareCompletions: number;
  skips: number;
  reports: number;
};

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
  policyVersion: typeof QUALITY_RANKING_POLICY_VERSION;
  qualityMode: QualityRankerMode;
  fallbackReason: string | null;
};

export type FeedItemRecommendation = {
  score: number;
  reasonCodes: Array<"INTEREST_MATCH" | "DEFAULT_TOPIC_BOOST" | "EXPLORATION" | "RECENT_FALLBACK">;
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
  categoryCode?: string;
  authorId?: string | null;
  contentHash?: string;
  question?: string;
  context?: string | null;
  choiceLabels?: string[];
  qualitySignals?: IssueQualitySignals;
};

export type RankedIssue = RankableIssue &
  FeedItemRecommendation & {
    explorationScore: number;
    qualityScore: number;
    shadowPosition: number | null;
    qualityEligible: boolean;
    eligibilityReasons: string[];
    candidateSources: CandidateSource[];
    scoreComponents: QualityScoreComponents;
    controversyEligible: boolean;
  };
