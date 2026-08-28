export const MEMBER_MODERATION_TARGET_TYPES = [
  "COMMENT_VERSION",
  "ISSUE_VERSION",
  "ISSUE_MEDIA_ASSET",
  "PROFILE_VERSION",
] as const;
export type MemberModerationTargetType = (typeof MEMBER_MODERATION_TARGET_TYPES)[number];

export type MemberModerationNotice = {
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
};

export type MemberModerationAppeal = {
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
};

export type MemberModerationRightsCase = {
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
};

export type MemberModerationAsset = {
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
};

export type MemberModerationCenter = {
  schemaVersion: 1;
  generatedAt: string;
  assets: MemberModerationAsset[];
  libraryAssets: Array<{ assetId: string; url: string }>;
  notices: MemberModerationNotice[];
  appeals: MemberModerationAppeal[];
  rightsCases: MemberModerationRightsCase[];
};

export interface MemberModerationService {
  readCenter(memberId: string): Promise<MemberModerationCenter>;
  createAppeal(input: {
    memberId: string;
    targetType: MemberModerationTargetType;
    targetId: string;
    reason: string;
    evidence?: Record<string, unknown>;
  }): Promise<MemberModerationAppeal>;
  createRightsCase(input: {
    memberId: string;
    requestType: MemberModerationRightsCase["requestType"];
    targetType: MemberModerationTargetType;
    targetId: string;
    details: string;
    evidence?: Record<string, unknown>;
  }): Promise<MemberModerationRightsCase>;
  chooseAssetAlternative(input: {
    memberId: string;
    submissionId: string;
    action: "TEXT_ONLY" | "APPROVED_LIBRARY" | "REPLACE_IMAGE" | "CANCEL_IMAGE";
    replacementAssetAId?: string;
    replacementAssetBId?: string;
  }): Promise<{ updated: true; revision: number }>;
}
