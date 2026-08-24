export type LaunchGateCheck = {
  name: string;
  status: "PASS" | "FAIL";
  summary: string;
  details?: Record<string, unknown>;
};

export type MigrationExpectation = {
  tag: string;
  appliedAt: number;
};

export type OutboxHealth = {
  total: number;
  pending: number;
  published: number;
  failed: number;
  oldestPendingAgeSeconds: number | null;
};

export type ProtectedFactDigest = {
  count: number;
  digest: string;
};

export type ProtectedFacts = {
  votes: ProtectedFactDigest;
  outboxEvents: ProtectedFactDigest;
};

export type RollbackBaseline = {
  capturedAt: string;
  appliedMigrationTimestamps: number[];
  outbox: OutboxHealth;
  protectedFacts: ProtectedFacts;
};

export type LaunchGateConfig = {
  targetEnvironment: "development" | "staging" | "production";
  apiBaseUrl: string;
  publicWebUrl: string;
  expectedReleaseId: string;
  internalAuthSecret: string;
  outboxDeliveryRequired: boolean;
  outboxWebhookUrl: string | null;
  outboxWebhookSecret: string | null;
  issueId: string;
  issueVersion: number;
  maxDeadLetters: number;
  maxPendingAgeSeconds: number;
  expectedMigrations: MigrationExpectation[];
};

export type HealthProbe = {
  statusCode: number;
  status: string | null;
  service: string | null;
};

export type MetaProbe = {
  statusCode: number;
  service: string | null;
  version: string | null;
  releaseId: string | null;
  featureFlags: Record<string, boolean> | null;
};

export type ReconciliationProbe = {
  statusCode: number;
  mode: string | null;
  status: string | null;
  mismatchCount: number | null;
};

export type PublicHomeProbe = {
  statusCode: number;
  isHtml: boolean;
};

export type PublicFeedProbe = {
  statusCode: number;
  itemCount: number | null;
};

export type PublicIssueProbe = PublicHomeProbe & {
  issueId: string | null;
};

export type PublicNextIssueProbe = PublicFeedProbe & {
  excludedIssueId: string | null;
  returnedIssueId: string | null;
};

export type OAuthStartProbe = {
  statusCode: number;
  providerHost: string | null;
};

export interface LaunchGateApiProbe {
  live(): Promise<HealthProbe>;
  ready(): Promise<HealthProbe>;
  meta(): Promise<MetaProbe>;
  reconcile(): Promise<ReconciliationProbe>;
}

export interface PublicWebProbe {
  home(): Promise<PublicHomeProbe>;
  feed(): Promise<PublicFeedProbe>;
  issueDeepLink(): Promise<PublicIssueProbe>;
  nextIssue(): Promise<PublicNextIssueProbe>;
  mobileFeed(): Promise<PublicFeedProbe>;
  login(): Promise<PublicHomeProbe>;
  signup(): Promise<PublicHomeProbe>;
  passwordRecovery(): Promise<PublicHomeProbe>;
  memberCenter(): Promise<PublicHomeProbe>;
  privacyPolicy(): Promise<PublicHomeProbe>;
  termsOfService(): Promise<PublicHomeProbe>;
  googleOAuthStart(): Promise<OAuthStartProbe>;
  xOAuthStart(): Promise<OAuthStartProbe>;
  naverOAuthStart(): Promise<OAuthStartProbe>;
  kakaoOAuthStart(): Promise<OAuthStartProbe>;
}

export interface LaunchGateStore {
  readAppliedMigrationTimestamps(): Promise<number[]>;
  readOutboxHealth(): Promise<OutboxHealth>;
  captureRollbackBaseline(): Promise<RollbackBaseline>;
  readProtectedFacts(capturedAt: string): Promise<ProtectedFacts>;
}

export type LaunchGateReport = {
  schemaVersion: 1;
  gate: "PUBLIC_MVP_V1";
  targetEnvironment: LaunchGateConfig["targetEnvironment"];
  expectedReleaseId: string;
  checkedAt: string;
  verdict: "GO" | "NO_GO";
  checks: LaunchGateCheck[];
};

export type PublicSurfaceReport = {
  schemaVersion: 1;
  gate: "PUBLIC_SURFACE_V1";
  publicWebUrl: string;
  checkedAt: string;
  verdict: "GO" | "NO_GO";
  checks: LaunchGateCheck[];
};

export type RollbackSnapshot = {
  schemaVersion: 1;
  snapshotType: "WHICH_ROLLBACK_V1";
  capturedAt: string;
  sourceReleaseId: string;
  rollbackTargetReleaseId: string;
  targetEnvironment: LaunchGateConfig["targetEnvironment"];
  database: RollbackBaseline;
};

export type RollbackVerificationReport = {
  schemaVersion: 1;
  verification: "ROLLBACK_V1";
  checkedAt: string;
  sourceReleaseId: string;
  expectedRollbackReleaseId: string;
  verdict: "VERIFIED" | "FAILED";
  checks: LaunchGateCheck[];
};
