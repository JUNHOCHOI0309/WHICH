export type ChoiceCode = "A" | "B" | "C" | "D";

export type IssueChoice = {
  id: string;
  code: ChoiceCode;
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
  acceptedC?: number;
  acceptedD?: number;
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
  contextMedia?: IssueChoice["media"];
  choices: IssueChoice[];
  engagement: {
    recommendationCount: number;
    commentCount: number;
    viewerRecommended: boolean;
    viewerReported: boolean;
  };
  recommendation: {
    requestId: string;
    score: number;
    reasonCodes: ("INTEREST_MATCH" | "DEFAULT_TOPIC_BOOST" | "EXPLORATION" | "RECENT_FALLBACK")[];
    matchedCardCodes: InterestCardCode[];
  };
};

export type PublicIssue = Omit<PublicFeedIssue, "engagement" | "recommendation"> & {
  context: string | null;
  experienceModeCode: string;
  result: {
    visibility: string;
    tally: IssueTally | null;
  };
};

export type IssueMediaLibraryPair = {
  id: string;
  title: string;
  categoryCode: string;
  topics: string[];
  assets: {
    id: string;
    side: "A" | "B";
    mediaAssetId: string;
    url: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    width: number;
    height: number;
    attributionText: string | null;
  }[];
  usageCount: number;
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
  choice: ChoiceCode;
  result: IssueTally;
  pointFeedback?: {
    amount: number;
    reasonLabel: string;
  };
};

export type PointRewardClaimResponse = { claimed: boolean };

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
  ledger: { items: MemberPointLedgerItem[]; nextCursor: string | null };
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
  choice: ChoiceCode;
  choiceLabel: string;
  choiceCount: number;
  acceptedAt: string;
  result: IssueTally;
};

export type MemberPrivateProfile = {
  member: MemberView & {
    avatarSource: "INITIALS" | "SOCIAL" | "CUSTOM";
    joinedAt: string;
    participationCount: number;
  };
  choiceSummary?: {
    majorityMatchPercent: number;
    minorityChoicePercent: number;
    recentSevenDayCount: number;
  };
  publicProfile: {
    handle: string;
    bio: string | null;
    visibility: "PRIVATE" | "PUBLIC";
    publicUrl: string | null;
  } | null;
  identities: {
    provider: "EMAIL" | "GOOGLE" | "X" | "NAVER" | "KAKAO" | "TIKTOK" | "DEVELOPMENT";
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

export type PublicComment = {
  id: string;
  choice: ChoiceCode;
  author: { displayName: string; avatarUrl?: string | null; isManager?: boolean };
  body: string;
  visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED" | "REMOVED_BY_AUTHOR";
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

export type CommentHighlight = PublicComment;

export type CommentHighlights = {
  A: CommentHighlight[];
  B: CommentHighlight[];
  C: CommentHighlight[];
  D: CommentHighlight[];
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
  totalCount: number;
};

export type CommentReportReason =
  "SPAM" | "HARASSMENT" | "HATE_OR_ABUSE" | "PERSONAL_INFORMATION" | "OTHER";

export type CommentListView = "NEWEST" | "HIGHLIGHT";

export type ShareChannel = "COPY" | "SYSTEM" | "X";

export type ShareCardResponse = {
  shareCard: {
    id: string;
    version: "result_share_v1";
    channel: ShareChannel;
    shareType: "RESULT" | "RESULT_WITH_CHOICE";
    sharedChoiceCode: ChoiceCode | null;
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

export type MemberIssueSubmissionStatus =
  "PENDING" | "APPROVED" | "NEEDS_CHANGES" | "REJECTED" | "CANCELLED";

export type MemberIssueSubmission = {
  id: string;
  revision: number;
  status: MemberIssueSubmissionStatus;
  publishedIssueId: string | null;
  publicationState:
    "PROCESSING" | "PUBLISHED" | "NEEDS_CHANGES" | "REJECTED" | "QUARANTINED" | "CANCELLED";
  question: string;
  context: string | null;
  choiceA: string;
  choiceB: string;
  choiceC?: string | null;
  choiceD?: string | null;
  contextMediaAssetId?: string | null;
  mediaAssetAId: string | null;
  mediaAssetBId: string | null;
  mediaAssetCId?: string | null;
  mediaAssetDId?: string | null;
  interestCardCode: InterestCardCode;
  reviewNote: string | null;
  submittedAt: string;
  updatedAt: string;
};

export type MemberIssueMediaAsset = {
  id: string;
  sourceType: "MEMBER_SUBMISSION";
  processingState: "READY";
  moderationState: "PENDING";
  storageState: "STAGED";
  rightsState: "ASSERTED";
};

export type IssueMediaUploadAccess = {
  mode: "OFF" | "PILOT" | "MEMBER";
  allowed: boolean;
  consentVersion: string;
  reasons: ("MODE_DISABLED" | "CAPABILITY_REQUIRED" | "CONSENT_REQUIRED" | "ACCOUNT_RESTRICTED")[];
  capability: {
    state: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";
    expiresAt: string;
  } | null;
  limits: { dailyUploads: number | null; maximumOpenAssets: number | null; maximumBytes: number };
};

export type MemberModerationTargetType =
  "COMMENT_VERSION" | "ISSUE_VERSION" | "ISSUE_MEDIA_ASSET" | "PROFILE_VERSION";

export type MemberModerationCenter = {
  schemaVersion: 1;
  generatedAt: string;
  assets: {
    assetId: string;
    issueSubmission: {
      id: string;
      question: string;
      publicationStatus: "PENDING" | "APPROVED" | "NEEDS_CHANGES" | "REJECTED" | "CANCELLED";
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
    alternatives: ("TEXT_ONLY" | "APPROVED_LIBRARY" | "REPLACE_IMAGE" | "CANCEL_IMAGE")[];
    appealId: string | null;
  }[];
  libraryAssets: { assetId: string; url: string }[];
  notices: {
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
    createdAt: string;
  }[];
  appeals: {
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
  }[];
  rightsCases: {
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
  }[];
};
