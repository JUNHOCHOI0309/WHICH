import type { IssueMediaAssetRecord } from "./contracts.js";

export const ISSUE_MEDIA_REVIEW_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "HIDDEN",
  "DELETED",
] as const;
export type IssueMediaReviewStatus = (typeof ISSUE_MEDIA_REVIEW_STATUSES)[number];
export const ISSUE_MEDIA_REVIEW_ACTIONS = [
  "APPROVED",
  "REJECTED",
  "HIDDEN",
  "RESTORED",
  "DELETED",
] as const;
export type IssueMediaReviewAction = (typeof ISSUE_MEDIA_REVIEW_ACTIONS)[number];
export const ISSUE_MEDIA_RIGHTS_TYPES = ["PRIVACY", "DEFAMATION", "COPYRIGHT"] as const;
export type IssueMediaRightsType = (typeof ISSUE_MEDIA_RIGHTS_TYPES)[number];

export type IssueMediaReviewDecision = {
  id: string;
  scope: "ASSET" | "ISSUE";
  assetId: string | null;
  issueId: string | null;
  status: IssueMediaReviewAction;
  reasonCode: string;
  rationale: string;
  policyVersion: string;
  reviewedBy: string;
  requestId: string;
  createdAt: string;
};

export type IssueMediaRuleFinding = {
  id: string;
  stage: string;
  code: string;
  severity: "INFO" | "REVIEW" | "BLOCK";
  sourceVersion: string;
  evidence: Record<string, unknown>;
  createdAt: string;
};

export type IssueMediaReviewAsset = IssueMediaAssetRecord & {
  effectiveStatus: IssueMediaReviewStatus;
  rightsAttestation: string;
  rightsAttestedAt: string;
  uploadedBy: string;
  link: {
    issueId: string;
    issueVersion: number;
    choiceId: string;
    choiceCode: string;
    choiceLabel: string;
    question: string;
    altText: string;
  } | null;
  latestDecision: IssueMediaReviewDecision | null;
  history: IssueMediaReviewDecision[];
  findings: IssueMediaRuleFinding[];
};

export type IssueMediaReviewPage = {
  schemaVersion: 1;
  generatedAt: string;
  counts: Record<IssueMediaReviewStatus, number>;
  items: IssueMediaReviewAsset[];
};

export type IssueMediaRightsRequest = {
  id: string;
  requestType: IssueMediaRightsType;
  assetId: string | null;
  issueId: string | null;
  requesterReference: string;
  details: string;
  status: "OPEN" | "ACTIONED" | "DISMISSED";
  resolution: string | null;
  actionDecisionId: string | null;
  recordedBy: string;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export interface IssueMediaReviewService {
  readAssets(input: {
    memberId: string;
    status?: IssueMediaReviewStatus;
    query?: string;
    limit: number;
    requestId?: string;
  }): Promise<IssueMediaReviewPage | null>;
  readAssetContent(input: {
    memberId: string;
    assetId: string;
    requestId?: string;
  }): Promise<Buffer | null>;
  decideAsset(input: {
    memberId: string;
    assetId: string;
    status: IssueMediaReviewAction;
    reasonCode: string;
    rationale: string;
    policyVersion: string;
    requestId: string;
  }): Promise<IssueMediaReviewAsset | null>;
  decideIssue(input: {
    memberId: string;
    issueId: string;
    status: "HIDDEN" | "RESTORED" | "DELETED";
    reasonCode: string;
    rationale: string;
    policyVersion: string;
    requestId: string;
  }): Promise<{ affected: number; decision: IssueMediaReviewDecision } | null>;
  readRightsRequests(input: {
    memberId: string;
    status?: "OPEN" | "ACTIONED" | "DISMISSED";
    limit: number;
    requestId?: string;
  }): Promise<IssueMediaRightsRequest[] | null>;
  createRightsRequest(input: {
    memberId: string;
    requestType: IssueMediaRightsType;
    assetId?: string;
    issueId?: string;
    requesterReference: string;
    details: string;
    policyVersion: string;
    requestId: string;
  }): Promise<IssueMediaRightsRequest | null>;
  resolveRightsRequest(input: {
    memberId: string;
    requestIdValue: string;
    status: "ACTIONED" | "DISMISSED";
    resolution: string;
    requestId: string;
  }): Promise<IssueMediaRightsRequest | null>;
}
