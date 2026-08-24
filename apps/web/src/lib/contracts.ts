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

export type MemberAvatar = { kind: "INITIALS"; initials: string } | { kind: "IMAGE"; url: string };

export type PublicIssue = {
  id: string;
  version: number;
  question: string;
  context: string | null;
  publishedAt: string;
  categoryCode: string;
  experienceModeCode: string;
  choices: IssueChoice[];
  author: {
    displayName: string;
    handle: string;
    avatar: MemberAvatar;
  } | null;
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

export type CreateIssueCommand = {
  question: string;
  context?: string | null;
  choiceA: string;
  choiceB: string;
  interestCardCode: InterestCardCode;
};

export type CreateIssueResponse = {
  issue: PublicIssue;
  created: boolean;
};

export type RankingMode = "PERSONALIZED" | "RECENCY";
export type RankingReasonCode =
  | "INTEREST_PROFILE_MATCH"
  | "PROFILE_NOT_READY"
  | "FEATURE_DISABLED"
  | "IDENTITY_UNAVAILABLE"
  | "RANKER_FALLBACK";

export type PublicFeedIssue = Omit<
  PublicIssue,
  "context" | "experienceModeCode" | "result" | "author"
> & {
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
  permissions: { canEdit: boolean; canDelete: boolean };
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
};

export type CommentHighlights = {
  A: PublicComment[];
  B: PublicComment[];
};

export type CommentWriteResponse = { comment: PublicComment };

export type CommentUpdateResponse = {
  comment: { id: string; body: string; editedAt: string };
};

export type CommentDeleteResponse = {
  comment: { id: string; deleted: true };
};

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

export type MemberPrivateVote = {
  voteId: string;
  issueId: string;
  issueVersion: number;
  question: string;
  categoryCode: string;
  choice: "A" | "B";
  choiceLabel: string;
  acceptedAt: string;
  result: IssueTally;
};

export type MemberPrivateProfile = {
  member: {
    id: string;
    displayName: string;
    status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
    avatar: MemberAvatar;
    joinedAt: string;
    participationCount: number;
  };
  publicProfile: MemberProfileSettings | null;
  identities: Array<{
    provider: "EMAIL" | "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";
    linkedAt: string;
    lastAuthenticatedAt: string;
  }>;
  votes: {
    items: MemberPrivateVote[];
    nextCursor: string | null;
  };
};

export type MemberProfileSettings = {
  handle: string;
  bio: string | null;
  visibility: "PRIVATE" | "PUBLIC";
  publicUrl: string | null;
};

export type PublicCreatorProfile = {
  creator: {
    displayName: string;
    handle: string;
    bio: string | null;
    joinedMonth: string;
    avatar: MemberAvatar;
  };
  stats: { publishedIssueCount: number; acceptedVoteCount: number };
  issues: Array<{
    id: string;
    version: number;
    question: string;
    categoryCode: string;
    publishedAt: string;
    acceptedVoteCount: number;
  }>;
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
