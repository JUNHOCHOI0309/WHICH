export type IssueChoice = {
  id: string;
  code: "A" | "B";
  label: string;
  media: {
    url: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    width: number;
    height: number;
  } | null;
};

export type IssueTally = {
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState: string;
};

export type PublicFeedIssue = {
  id: string;
  version: number;
  question: string;
  publishedAt: string;
  categoryCode: string;
  mediaMode: "TEXT_ONLY" | "OPTION_IMAGES";
  choices: IssueChoice[];
  recommendation: {
    requestId: string;
    score: number;
    reasonCodes: ("INTEREST_MATCH" | "DEFAULT_TOPIC_BOOST" | "EXPLORATION" | "RECENT_FALLBACK")[];
    matchedCardCodes: InterestCardCode[];
  };
};

export type PublicIssue = PublicFeedIssue & {
  context: string | null;
  experienceModeCode: string;
  result: {
    visibility: string;
    tally: IssueTally | null;
  };
};

export type PublicIssueFeed = {
  items: PublicFeedIssue[];
  nextCursor: string | null;
  ranking: {
    requestId: string;
    version: "interest_content_v2_refresh" | "quality_feed_v1";
    mode: "PERSONALIZED" | "RECENCY";
    reasonCode:
      | "INTEREST_PROFILE_MATCH"
      | "PROFILE_NOT_READY"
      | "FEATURE_DISABLED"
      | "IDENTITY_UNAVAILABLE"
      | "RANKER_FALLBACK";
    profileVersion: number | null;
    policyVersion?: "quality-feed-v1.0";
    qualityMode?: "OFF" | "SHADOW" | "LIVE";
    fallbackReason?: string | null;
  };
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

export type MemberPointLedgerItem = {
  id: string;
  entryType: "EARN" | "SPEND" | "REFUND" | "REVERSAL" | "ADJUSTMENT";
  amount: number;
  reasonCode: string;
  reasonLabel: string;
  createdAt: string;
};

export type MemberPointView = {
  account: {
    balance: number;
    todayEarned: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    hasPendingRecovery: boolean;
  };
  ledger: { items: MemberPointLedgerItem[]; nextCursor: string | null };
};

export type MemberView = {
  id: string;
  displayName: string;
  status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
  avatar: { kind: "INITIALS"; initials: string } | { kind: "IMAGE"; url: string };
};

export type MemberSessionView = {
  token: string;
  expiresAt: string;
  member: MemberView;
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
  member: MemberView & {
    avatarSource: "INITIALS" | "SOCIAL" | "CUSTOM";
    joinedAt: string;
    participationCount: number;
  };
  publicProfile: {
    handle: string;
    bio: string | null;
    visibility: "PRIVATE" | "PUBLIC";
    publicUrl: string | null;
  } | null;
  identities: {
    provider: "EMAIL" | "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";
    linkedAt: string;
    lastAuthenticatedAt: string;
  }[];
  votes: {
    items: MemberPrivateVote[];
    nextCursor: string | null;
  };
};

export type MemberProfileSettings = {
  displayName: string;
  handle: string;
  bio: string | null;
  visibility: "PRIVATE" | "PUBLIC";
  publicUrl: string | null;
};

export type MemberAvatarUpdate = {
  member: MemberView & { avatarSource: "INITIALS" | "CUSTOM" };
};

export type MemberAccountDeletionResult = {
  deleted: true;
};

export type CommentHighlight = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string };
  body: string;
  reactions: { helpfulCount: number; viewerReacted: boolean };
};

export type CommentHighlights = {
  A: CommentHighlight[];
  B: CommentHighlight[];
};

export type ShareChannel = "COPY" | "SYSTEM" | "X";

export type ShareCardResponse = {
  shareCard: {
    id: string;
    version: "result_share_v1";
    channel: ShareChannel;
    shareType: "RESULT" | "RESULT_WITH_CHOICE";
    sharedChoiceCode: "A" | "B" | null;
  };
  url: string;
};

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
  cards: {
    code: InterestCardCode;
    label: string;
    categoryCodes: string[];
    topicCodes: string[];
  }[];
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
