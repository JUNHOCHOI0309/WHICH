export const ISSUE_MEDIA_INPUT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type IssueMediaInputMimeType = (typeof ISSUE_MEDIA_INPUT_MIME_TYPES)[number];

export type IssueMediaAssetRecord = {
  id: string;
  sourceType: "OPERATOR_UPLOAD" | "MEMBER_SUBMISSION";
  sha256: string;
  perceptualHash: string;
  input: { mimeType: IssueMediaInputMimeType; byteSize: number; width: number; height: number };
  output: { mimeType: "image/webp"; byteSize: number; width: number; height: number };
  processingState: "READY" | "FAILED";
  moderationState: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
  storageState: "STAGED" | "PUBLISHED" | "QUARANTINED" | "PURGED";
  rightsState: "ASSERTED" | "CHALLENGED" | "CLEARED" | "WITHDRAWN";
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueMediaLibraryPair = {
  id: string;
  title: string;
  categoryCode: string;
  topics: string[];
  status: "PUBLISHED" | "REVOKED";
  assets: Array<{
    id: string;
    side: "A" | "B";
    mediaAssetId: string;
    url: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    width: number;
    height: number;
    attributionText: string | null;
  }>;
  usageCount: number;
  createdAt: string;
};

export type RegisterIssueMediaLibraryPair = {
  title: string;
  categoryCode: string;
  topics: string[];
  assets: Array<{
    side: "A" | "B";
    mediaAssetId: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    sourceUrl: string;
    authorName: string;
    licenseName: string;
    licenseVersion: string;
    acquiredAt: string;
    commercialAllowed: boolean;
    derivativeAllowed: boolean;
    redistributionAllowed: boolean;
    attributionText?: string | null;
    evidenceReference: string;
    expiresAt?: string | null;
  }>;
};

export type IssueMediaObjectStorage = {
  stage(assetId: string, body: Buffer): Promise<{ objectKey: string }>;
  publish(assetId: string, stagingObjectKey: string): Promise<{ objectKey: string; url: string }>;
  quarantine(input: {
    assetId: string;
    stagingObjectKey?: string | null;
    publishedObjectKey?: string | null;
  }): Promise<{ objectKey: string }>;
  restorePublished(assetId: string, quarantinedObjectKey: string): Promise<{ objectKey: string }>;
  read(objectKey: string): Promise<Buffer>;
  exists?(objectKey: string): Promise<boolean>;
  purge(objectKeys: Array<string | null | undefined>): Promise<void>;
  publicUrl(objectKey: string): string;
};

export interface IssueMediaService {
  listLibraryPairs(input: {
    query?: string;
    categoryCode?: string;
    limit: number;
  }): Promise<{ items: IssueMediaLibraryPair[] }>;
  registerLibraryPair(input: {
    memberId: string;
    pair: RegisterIssueMediaLibraryPair;
    requestId?: string;
  }): Promise<IssueMediaLibraryPair | null>;
  revokeLibraryPair(input: {
    memberId: string;
    pairId: string;
    reason: string;
    requestId?: string;
  }): Promise<{ pairId: string; fallbackIssueCount: number } | null>;
  stageAsset(input: {
    memberId: string;
    sourceType: "OPERATOR_UPLOAD";
    rightsAttestation: string;
    declaredMimeType: IssueMediaInputMimeType;
    bytes: Buffer;
    requestId?: string;
  }): Promise<IssueMediaAssetRecord | null>;
  stageMemberAsset(input: {
    memberId: string;
    uploadSessionId?: string;
    rightsAttestation: string;
    declaredMimeType: IssueMediaInputMimeType;
    bytes: Buffer;
    requestId?: string;
  }): Promise<IssueMediaAssetRecord>;
  approveAndPublish(input: {
    memberId: string;
    assetId: string;
    requestId?: string;
  }): Promise<IssueMediaAssetRecord | null>;
  attachChoice(input: {
    memberId: string;
    issueId: string;
    issueVersion: number;
    choiceId: string;
    assetId: string;
    altText: string;
    cropMode: "COVER" | "CONTAIN";
    displayPosition: 0 | 1;
    requestId?: string;
  }): Promise<{ attached: true; replacedAssetId: string | null } | null>;
  detachChoice(input: {
    memberId: string;
    issueId: string;
    issueVersion: number;
    choiceId: string;
    requestId?: string;
  }): Promise<{ detached: boolean } | null>;
  quarantineAsset(input: {
    memberId: string;
    assetId: string;
    reason: "ISSUE_BLINDED" | "RIGHTS_CHALLENGED" | "MODERATION_REVOKED";
    requestId?: string;
  }): Promise<IssueMediaAssetRecord | null>;
  purgeAsset(input: {
    memberId: string;
    assetId: string;
    reason: "ISSUE_DELETED" | "RIGHTS_WITHDRAWN" | "ORPHAN_CLEANUP";
    requestId?: string;
  }): Promise<IssueMediaAssetRecord | null>;
  quarantineIssue(input: {
    memberId: string;
    issueId: string;
    reason: "ISSUE_BLINDED" | "RIGHTS_CHALLENGED";
    requestId?: string;
  }): Promise<{ quarantined: number } | null>;
  purgeIssue(input: {
    memberId: string;
    issueId: string;
    reason: "ISSUE_DELETED" | "RIGHTS_WITHDRAWN";
    requestId?: string;
  }): Promise<{ purged: number } | null>;
  purgeOrphans(input: {
    memberId: string;
    olderThanHours: number;
    requestId?: string;
  }): Promise<{ purged: number } | null>;
}
