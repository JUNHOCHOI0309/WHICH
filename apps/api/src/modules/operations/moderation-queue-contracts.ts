export const OPS_MODERATION_QUEUE_LANES = [
  "HIGH",
  "NORMAL",
  "RIGHTS",
  "APPEAL",
  "RANDOM_AUDIT",
] as const;

export type OpsModerationQueueLane = (typeof OPS_MODERATION_QUEUE_LANES)[number];
export type OpsModerationTargetType = "ISSUE_MEDIA_ASSET" | "COMMENT_VERSION";

export type OpsModerationQueueItem = {
  caseId: string;
  expectedRevision: number;
  lane: OpsModerationQueueLane;
  priority: "P0" | "P1" | "P2" | "P3";
  status: string;
  targetType: OpsModerationTargetType;
  targetId: string;
  openedAt: string;
  updatedAt: string;
  risky: boolean;
  summary: string;
  context:
    | {
        kind: "IMAGE";
        assetId: string;
        question: string | null;
        choices: Array<{
          code: string;
          label: string;
          assetId: string | null;
          altText: string | null;
          cropMode: string | null;
        }>;
        rightsAttestation: string;
        rightsState: string;
        uploadedBy: string;
        input: { width: number; height: number; byteSize: number };
        output: { width: number; height: number; byteSize: number };
        priorDecisions: Array<{
          id: string;
          status: string;
          reasonCode: string;
          rationale: string;
          reviewedBy: string;
          createdAt: string;
        }>;
      }
    | {
        kind: "COMMENT";
        commentId: string;
        issueId: string;
        authorDisplayName: string;
        body: string;
        publicationState: string;
        visibility: string;
        integrityState: string;
        reportScore: number;
        reporterCount: number;
      };
};

export type OpsModerationQueuePage = {
  schemaVersion: 1;
  generatedAt: string;
  metrics: {
    queueCount: number;
    oldestAgeSeconds: number | null;
    reviewSecondsP50: number | null;
    reviewSecondsP95: number | null;
    averageSecondsPerAsset: number | null;
    weeklyOperatorHours: number;
    inflow7d: number;
    outflow7d: number;
  };
  counts: Record<OpsModerationQueueLane, number>;
  operational: ModerationOperationalHealth;
  items: OpsModerationQueueItem[];
};

export type OpsModerationQueueDecision = {
  expectedRevision: number;
  action:
    | "APPROVED"
    | "REJECTED"
    | "HIDDEN"
    | "RESTORED"
    | "DELETED"
    | "COLLAPSE"
    | "HIDE"
    | "REMOVE_POLICY"
    | "RESTORE";
  reasonCode: string;
  rationale: string;
  policyVersion: string;
};

export interface OpsModerationQueueService {
  readQueue(input: {
    memberId: string;
    lane?: OpsModerationQueueLane;
    limit: number;
    requestId: string;
  }): Promise<OpsModerationQueuePage | null>;
  recordView(input: {
    memberId: string;
    caseId: string;
    eventType: "CASE_VIEWED" | "ASSET_REVEALED" | "ORIGINAL_VIEWED";
    requestId: string;
  }): Promise<boolean>;
  decide(input: {
    memberId: string;
    caseId: string;
    decision: OpsModerationQueueDecision;
    requestId: string;
  }): Promise<{ expectedRevision: number } | null>;
}
import type { ModerationOperationalHealth } from "../moderation-operations/operational-health.js";
