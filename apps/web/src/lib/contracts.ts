export type IssueChoice = {
  id: string;
  code: "A" | "B";
  label: string;
};

export type IssueTally = {
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState:
    "NORMAL" | "MONITORING" | "DEGRADED" | "UNDER_REVIEW" | "RESULT_LOCKED" | "CORRECTED";
};

export type PublicIssue = {
  id: string;
  version: number;
  question: string;
  context: string | null;
  publishedAt: string;
  categoryCode: string;
  experienceModeCode: string;
  choices: IssueChoice[];
  result: {
    visibility:
      | "PRE_VOTE_HIDDEN"
      | "RESULT_VISIBLE"
      | "RESULT_LOCKED"
      | "RESULT_DEGRADED"
      | "RESULT_UNAVAILABLE";
    tally: IssueTally | null;
  };
};

export type RankingMode = "PERSONALIZED" | "RECENCY";
export type RankingReasonCode =
  | "INTEREST_PROFILE_MATCH"
  | "PROFILE_NOT_READY"
  | "FEATURE_DISABLED"
  | "IDENTITY_UNAVAILABLE"
  | "RANKER_FALLBACK";

export type PublicFeedIssue = Omit<PublicIssue, "context" | "experienceModeCode" | "result"> & {
  recommendation: {
    requestId: string;
    score: number;
    reasonCodes: Array<"INTEREST_MATCH" | "EXPLORATION" | "RECENT_FALLBACK">;
    matchedCardCodes: InterestCardCode[];
  };
};

export type PublicIssueFeed = {
  items: PublicFeedIssue[];
  nextCursor: string | null;
  ranking: {
    requestId: string;
    version: "interest_content_v1";
    mode: RankingMode;
    reasonCode: RankingReasonCode;
    profileVersion: number | null;
  };
};

export type CommentSide = "ALL" | "A" | "B";
export type CommentReportReason =
  "SPAM" | "HARASSMENT" | "HATE_OR_ABUSE" | "PERSONAL_INFORMATION" | "OTHER";

export type PublicComment = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string };
  body: string;
  visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED";
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
  reactions: { helpfulCount: number; viewerReacted: boolean };
  reports: { viewerReported: boolean; canReport: boolean };
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
};

export type CommentWriteResponse = { comment: PublicComment };

export type HelpfulReactionResponse = {
  reaction: { code: "HELPFUL"; active: boolean; helpfulCount: number };
};

export type CommentReportResponse = {
  report: { accepted: true; viewerReported: true };
  comment: { visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED" | "HIDDEN" };
};

export type VoteResponse = {
  outcome: "ACCEPTED" | "REJECTED_DUPLICATE";
  voteAttemptId: string;
  voteId: string;
  issueId: string;
  issueVersion: number;
  choice: "A" | "B";
  result: IssueTally;
};

export type ShareChannel = "COPY" | "SYSTEM" | "X";

export type PublicShareCard = {
  id: string;
  version: "result_share_v1";
  channel: ShareChannel;
  shareType: "RESULT" | "RESULT_WITH_CHOICE";
  sharedChoiceCode: "A" | "B" | null;
  createdAt: string;
  issue: {
    id: string;
    version: number;
    question: string;
    choices: Array<{ code: "A" | "B"; label: string }>;
  };
  result: IssueTally;
};

export type ShareCardResponse = { shareCard: PublicShareCard; url: string };

export type ApiErrorBody = {
  code: string;
  message: string;
};

export type InterestCardCode =
  | "DAILY_LIFE"
  | "FOOD"
  | "TRAVEL"
  | "RELATIONSHIP"
  | "WORK"
  | "ECONOMY_CONSUMPTION"
  | "TECH"
  | "GAME"
  | "MOVIE_DRAMA"
  | "MUSIC_CONTENT"
  | "SPORTS"
  | "EDUCATION"
  | "SOCIETY"
  | "HOBBY";

export type InterestCardRegistry = {
  taxonomyVersion: "interest_cards_v1";
  minSelections: 3;
  maxSelections: 8;
  cards: Array<{
    code: InterestCardCode;
    label: string;
    categoryCodes: string[];
    topicCodes: string[];
  }>;
};

export type InterestProfile = {
  taxonomyVersion: "interest_cards_v1";
  onboardingState: "NOT_STARTED" | "COMPLETED" | "SKIPPED" | "RESET";
  selectedCardCodes: InterestCardCode[];
  canSkip: boolean;
  profileVersion: number;
  mergeCandidate: {
    anonymousSubjectId: string;
    guestCardCodes: InterestCardCode[];
    suggestedCardCodes: InterestCardCode[];
  } | null;
};
