export type ModerationTargetType =
  "COMMENT_VERSION" | "ISSUE_VERSION" | "ISSUE_MEDIA_ASSET" | "PROFILE_VERSION";

export type RegisterModerationTargetCommand = {
  targetType: ModerationTargetType;
  targetId: string;
  targetVersion: number;
  inputHash: string;
  snapshotReference: string;
};

export type RecordModerationRunCommand = {
  targetId: string;
  recheckRequestId?: string;
  policyVersion: string;
  stage: string;
  normalizedInputHash: string;
  modelProvider?: string;
  modelName?: string;
  modelVersion?: string;
  ruleVersion: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  decisionSource: "RULE" | "MODEL" | "OPERATOR" | "SYSTEM";
  result?: Record<string, unknown>;
  latencyMs?: number;
  costMicros?: number;
  errorCode?: string;
  errorMessage?: string;
  completedAt?: Date;
};

export type OpenModerationCaseCommand = {
  targetId: string;
  latestRunId?: string;
  riskLane: "ALLOW" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "RIGHTS";
  priority: "P0" | "P1" | "P2" | "P3";
  slaDueAt?: Date;
  assignedToMemberId?: string;
};

export type UpdateModerationCaseCommand = {
  caseId: string;
  expectedRevision: number;
  status?: "OPEN" | "TRIAGED" | "IN_REVIEW" | "RESOLVED" | "CANCELLED";
  riskLane?: OpenModerationCaseCommand["riskLane"];
  priority?: OpenModerationCaseCommand["priority"];
  slaDueAt?: Date | null;
  assignedToMemberId?: string | null;
};

export type LinkModerationCaseReferenceCommand = {
  caseId: string;
  referenceType:
    "CONTENT_REPORT" | "COMMENT_REPORT" | "RIGHTS_REQUEST" | "APPEAL" | "RECONCILIATION";
  referenceId: string;
};

export type RecordModerationActionCommand = {
  caseId: string;
  actionType: string;
  domainDecisionType: "COMMENT_MODERATION_DECISION" | "ISSUE_MEDIA_REVIEW_DECISION";
  domainDecisionId: string;
  actorType: "OPERATOR" | "SYSTEM";
  actorMemberId?: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  durationSeconds?: number;
  expiresAt?: Date;
  reversalOfActionId?: string;
  noticeKey: string;
};

export type RecordModerationReconciliationCommand = {
  caseId?: string;
  targetId: string;
  resourceType: "DATABASE" | "R2" | "CDN";
  expectedReference: string;
  observedReference?: string;
  status: "CONSISTENT" | "MISMATCH" | "REPAIRED" | "FAILED";
  repairReference?: string;
  actorType: "OPERATOR" | "SYSTEM";
  actorMemberId?: string;
  resolvedAt?: Date;
};

export interface ModerationOperationsService {
  registerTarget(
    command: RegisterModerationTargetCommand,
  ): Promise<{ created: boolean; id: string }>;
  recordRun(command: RecordModerationRunCommand): Promise<{ created: boolean; id: string }>;
  openCase(command: OpenModerationCaseCommand): Promise<{ id: string; expectedRevision: number }>;
  updateCase(
    command: UpdateModerationCaseCommand,
  ): Promise<{ id: string; expectedRevision: number }>;
  linkCaseReference(
    command: LinkModerationCaseReferenceCommand,
  ): Promise<{ created: boolean; id: string }>;
  recordAction(command: RecordModerationActionCommand): Promise<{ id: string }>;
  recordReconciliation(command: RecordModerationReconciliationCommand): Promise<{ id: string }>;
}
