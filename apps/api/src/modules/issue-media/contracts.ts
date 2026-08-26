export const ISSUE_MEDIA_INPUT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type IssueMediaInputMimeType = (typeof ISSUE_MEDIA_INPUT_MIME_TYPES)[number];

export type IssueMediaAssetRecord = {
  id: string;
  sourceType: "OPERATOR_UPLOAD";
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

export type IssueMediaObjectStorage = {
  stage(assetId: string, body: Buffer): Promise<{ objectKey: string }>;
  publish(assetId: string, stagingObjectKey: string): Promise<{ objectKey: string; url: string }>;
  quarantine(input: {
    assetId: string;
    stagingObjectKey?: string | null;
    publishedObjectKey?: string | null;
  }): Promise<{ objectKey: string }>;
  purge(objectKeys: Array<string | null | undefined>): Promise<void>;
  publicUrl(objectKey: string): string;
};

export interface IssueMediaService {
  stageAsset(input: {
    memberId: string;
    sourceType: "OPERATOR_UPLOAD";
    rightsAttestation: string;
    declaredMimeType: IssueMediaInputMimeType;
    bytes: Buffer;
    requestId?: string;
  }): Promise<IssueMediaAssetRecord | null>;
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
