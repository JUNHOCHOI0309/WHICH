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
  mediaMode: "TEXT_ONLY" | "OPTION_IMAGES";
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
  libraryPairId?: string | null;
  interestCardCode: InterestCardCode;
};

export type IssueMediaLibraryPair = {
  id: string;
  title: string;
  categoryCode: string;
  topics: string[];
  assets: Array<{
    id: string;
    side: "A" | "B";
    url: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    width: number;
    height: number;
    attributionText: string | null;
  }>;
  usageCount: number;
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
    reasonCodes: Array<
      "INTEREST_MATCH" | "DEFAULT_TOPIC_BOOST" | "EXPLORATION" | "RECENT_FALLBACK"
    >;
    matchedCardCodes: InterestCardCode[];
  };
};

export type PublicIssueFeed = {
  items: PublicFeedIssue[];
  nextCursor: string | null;
  ranking: {
    requestId: string;
    version: "interest_content_v2_refresh" | "quality_feed_v1";
    mode: RankingMode;
    reasonCode: RankingReasonCode;
    profileVersion: number | null;
    policyVersion?: "quality-feed-v1.0";
    qualityMode?: "OFF" | "SHADOW" | "LIVE";
    fallbackReason?: string | null;
  };
  rightRail?: {
    version: "participation_v1";
    items: Array<{
      issueId: string;
      question: string;
      categoryCode: string;
      participationCount: number;
      reasonCode: "RECENT_PARTICIPATION" | "RECENT_FALLBACK";
    }>;
  };
};

export type PublicIssueCatalogItem = Pick<
  PublicIssue,
  "id" | "version" | "question" | "context" | "publishedAt" | "categoryCode" | "choices"
>;

export type PublicIssueCatalog = {
  items: PublicIssueCatalogItem[];
};

export type CommentSide = "ALL" | "A" | "B";
export type CommentSort = "NEWEST" | "HELPFUL";
export type CommentReportReason =
  "SPAM" | "HARASSMENT" | "HATE_OR_ABUSE" | "PERSONAL_INFORMATION" | "OTHER";

export type PublicComment = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string; avatarUrl?: string | null };
  body: string;
  visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED";
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
  parentCommentId: string | null;
  reactions: {
    helpfulCount: number;
    dislikeCount: number;
    viewerReaction: "HELPFUL" | "DISLIKE" | null;
  };
  reports: { viewerReported: boolean; canReport: boolean };
  permissions: { canEdit: boolean; canDelete: boolean };
  replies: PublicComment[];
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
  totalCount: number;
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

export type CommentReactionResponse = {
  reaction: {
    code: "HELPFUL" | "DISLIKE";
    active: boolean;
    helpfulCount: number;
    dislikeCount: number;
  };
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
  pointFeedback?: {
    amount: number;
    reasonLabel: string;
  };
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
    avatarSource: "INITIALS" | "SOCIAL" | "CUSTOM";
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

export type MemberModerationTargetType =
  "COMMENT_VERSION" | "ISSUE_VERSION" | "ISSUE_MEDIA_ASSET" | "PROFILE_VERSION";

export type MemberModerationCenter = {
  schemaVersion: 1;
  generatedAt: string;
  assets: Array<{
    assetId: string;
    issueSubmission: {
      id: string;
      question: string;
      publicationStatus: "PENDING" | "APPROVED" | "NEEDS_CHANGES" | "REJECTED";
      updatedAt: string;
    } | null;
    assetReview: {
      status: "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN" | "DELETED";
      policyVersion: string;
      reasonCode: string;
      action: string;
      submittedAt: string;
      lastChangedAt: string;
    };
    alternatives: Array<"TEXT_ONLY" | "APPROVED_LIBRARY" | "REPLACE_IMAGE" | "CANCEL_IMAGE">;
    appealId: string | null;
  }>;
  libraryAssets: Array<{ assetId: string; url: string }>;
  notices: Array<{
    id: string;
    targetType: MemberModerationTargetType;
    targetId: string;
    policyVersion: string;
    reasonCode: string;
    actionType: string;
    summary: string;
    nextStep: string;
    effectiveAt: string;
    expiresAt: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
  appeals: Array<{
    id: string;
    targetType: MemberModerationTargetType;
    targetId: string;
    reason: string;
    status: "SUBMITTED" | "IN_REVIEW" | "UPHELD" | "OVERTURNED" | "CANCELLED";
    resolution: string | null;
    submittedAt: string;
    reviewedAt: string | null;
    resolvedAt: string | null;
    updatedAt: string;
  }>;
  rightsCases: Array<{
    id: string;
    requestType: "PRIVACY" | "DEFAMATION" | "COPYRIGHT";
    targetType: MemberModerationTargetType;
    targetId: string;
    details: string;
    status: "SUBMITTED" | "IN_REVIEW" | "ACTIONED" | "DISMISSED" | "WITHDRAWN";
    resolution: string | null;
    legalHoldUntil: string | null;
    dueAt: string | null;
    submittedAt: string;
    resolvedAt: string | null;
    updatedAt: string;
  }>;
};

export type MemberNotificationCenter = {
  schemaVersion: 1;
  generatedAt: string;
  unreadCount: number;
  items: MemberModerationCenter["notices"];
};

export type MemberPointLedgerItem = {
  id: string;
  entryType: "EARN" | "SPEND" | "REFUND" | "REVERSAL" | "ADJUSTMENT";
  amount: number;
  reasonCode: string;
  reasonLabel: string;
  createdAt: string;
};

export type MemberPointBadge = {
  code: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";
  label: string;
  minimumLifetimePoints: number;
  assetKey: string;
  awardedAt?: string;
};

export type MemberPointView = {
  account: {
    balance: number;
    todayEarned: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    hasPendingRecovery: boolean;
  };
  badge: {
    policyVersion: string;
    current: MemberPointBadge | null;
    next: MemberPointBadge | null;
    progress: number;
  };
  ledger: {
    items: MemberPointLedgerItem[];
    nextCursor: string | null;
  };
};

export type PointShopEquipSlot = "PROFILE_ACCENT" | "AVATAR_FRAME" | "SHARE_BACKGROUND";

export type PointShopCatalogItem = {
  id: string;
  code: string;
  itemType: string;
  surface: string;
  equipSlot: PointShopEquipSlot;
  themeFamily: string;
  name: string;
  description: string;
  price: number;
  permanent: boolean;
  currentVersion: number;
  assetManifest: Record<string, unknown>;
  previewAssets: Record<string, unknown>;
  accessibilityMetadata: Record<string, unknown>;
  owned: boolean;
  equipped: boolean;
};

export type MemberPointShopView = {
  balance: number;
  catalog: PointShopCatalogItem[];
  equipment: Partial<Record<PointShopEquipSlot, string>>;
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
