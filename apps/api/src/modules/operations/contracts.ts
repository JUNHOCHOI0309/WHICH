export const OPS_DASHBOARD_WINDOWS = [1, 7, 30] as const;
export type OpsDashboardWindow = (typeof OPS_DASHBOARD_WINDOWS)[number];

export type OpsDashboardSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  windowDays: OpsDashboardWindow;
  role: "OPERATOR";
  system: {
    releaseId: string;
    apiReadiness: "READY";
    migrations: { applied: number; latestAppliedAt: string | null };
    outbox: {
      total: number;
      pending: number;
      published: number;
      failed: number;
      oldestPendingAgeSeconds: number | null;
    };
    backup: { lastConfirmedAt: string | null; reference: string | null };
  };
  funnel: {
    officialPopulation: string;
    refreshedAt: string | null;
    stages: {
      viewable: number;
      submit: number;
      accepted: number;
      result: number;
      next: number;
      secondVote: number;
    };
    rates: {
      submitPerViewable: number;
      acceptedPerSubmit: number;
      resultPerAccepted: number;
      nextPerResult: number;
      secondVotePerAccepted: number;
    };
    reconciliation: {
      aggregatedAcceptedVotes: number;
      sourceAcceptedVotes: number;
      difference: number;
      status: "CONSISTENT" | "MISMATCH";
    };
    excludedSessions: Array<{ trafficClass: string; sessions: number }>;
  };
  content: {
    production: {
      eligibleIssues: number;
      zeroExposureIssues: number;
      activeByCategory: Array<{ categoryCode: string; issues: number }>;
      belowMinimumCategories: Array<{ categoryCode: string; issues: number; minimum: number }>;
    };
    editorial: {
      policyId: string;
      ready: boolean;
      activeIssues: number;
      reserveIssues: number;
      longTermIssues: number;
      dailyPublicationTarget: number;
      activeDaysOfSupply: number;
      reserveDaysOfSupply: number;
      violationCount: number;
    };
  };
  trust: {
    moderation: {
      reports: number;
      reportedComments: number;
      queueSize: number;
      oldestQueueHours: number;
      decisions: number;
      hidden: number;
      restored: number;
    };
    integrity: {
      acceptedVotes: number;
      reviewVotes: number;
      rejectedDuplicateVotes: number;
      rejectedAbuseVotes: number;
      invalidatedVotes: number;
      incompleteVoteAttempts: number;
      authRateLimitBuckets: number;
    };
  };
  warnings: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
  }>;
  runbooks: Array<{ label: string; path: string }>;
};

export const OPS_MEMBER_STATUSES = ["ACTIVE", "LIMITED", "SUSPENDED", "DELETED"] as const;
export type OpsMemberStatus = (typeof OPS_MEMBER_STATUSES)[number];

export type OpsMemberRecord = {
  memberId: string;
  displayName: string;
  status: OpsMemberStatus;
  handle: string | null;
  profileVisibility: "PRIVATE" | "PUBLIC" | null;
  providers: string[];
  joinedAt: string;
  lastActiveAt: string | null;
  activity: { votes: number; comments: number; issues: number };
};

export type OpsMemberPage = {
  schemaVersion: 1;
  generatedAt: string;
  items: OpsMemberRecord[];
  nextCursor: string | null;
};

export type OpsRankingPreview = {
  schemaVersion: 1;
  generatedAt: string;
  configuredMode: "OFF" | "SHADOW" | "LIVE";
  policyVersion: string;
  items: Array<{
    requestId: string;
    servedPosition: number;
    shadowPosition: number | null;
    issueId: string;
    question: string;
    categoryCode: string;
    servedScore: number;
    qualityScore: number;
    candidateSources: string[];
    scoreComponents: Record<string, number>;
    qualityEligible: boolean;
    eligibilityReasons: string[];
    controversyEligible: boolean;
    rankingReason: string;
    fallbackReason: string | null;
    createdAt: string;
  }>;
};

export const OPS_EDITORIAL_STATUSES = ["PENDING", "APPROVED", "NEEDS_CHANGES", "REJECTED"] as const;
export type OpsEditorialStatus = (typeof OPS_EDITORIAL_STATUSES)[number];
export const OPS_EDITORIAL_SCOPES = ["ACTIVE", "RESERVE", "LONG_TERM"] as const;
export type OpsEditorialScope = (typeof OPS_EDITORIAL_SCOPES)[number];

export type OpsEditorialDecision = {
  status: Exclude<OpsEditorialStatus, "PENDING">;
  note: string;
  reviewedBy: string;
  reviewedAt: string;
  revision: number;
  checks: {
    binaryFit: boolean;
    choiceParity: boolean;
    duplicateReview: boolean;
    sourceReview: boolean;
  };
};

export type OpsEditorialCandidate = {
  candidateId: string;
  question: string;
  context: string;
  choices: Array<{ code: string; label: string }>;
  category: string;
  interestCardCodes: string[];
  editorialArea: string;
  riskLevel: string;
  inventoryScope: OpsEditorialScope;
  discoveryLead: string;
  sourceRequirement: string;
  sources: Array<{ id: string; kind: "FACT" | "COMMUNITY"; title?: string; url?: string }>;
  automatedReviewStatus: string;
  decision: OpsEditorialDecision | null;
};

export type OpsEditorialPage = {
  schemaVersion: 1;
  generatedAt: string;
  catalog: { id: string; total: number; approval: string };
  inventory: { active: number; reserve: number; longTerm: number };
  counts: Record<OpsEditorialStatus, number>;
  items: OpsEditorialCandidate[];
  nextCursor: string | null;
};

export class OpsReviewConflictError extends Error {
  constructor(public readonly current: OpsEditorialDecision | null) {
    super("The Editorial Review decision changed after this screen was loaded.");
    this.name = "OpsReviewConflictError";
  }
}

export interface OpsDashboardService {
  readDashboard(input: {
    memberId: string;
    windowDays: OpsDashboardWindow;
    requestId?: string;
  }): Promise<OpsDashboardSnapshot | null>;
  readMembers(input: {
    memberId: string;
    status?: OpsMemberStatus;
    query?: string;
    cursor?: string;
    limit: number;
    requestId?: string;
  }): Promise<OpsMemberPage | null>;
  readRankingPreview(input: {
    memberId: string;
    limit: number;
    requestId?: string;
  }): Promise<OpsRankingPreview | null>;
  readEditorial(input: {
    memberId: string;
    status?: OpsEditorialStatus;
    scope?: OpsEditorialScope;
    query?: string;
    cursor?: string;
    limit: number;
    requestId?: string;
  }): Promise<OpsEditorialPage | null>;
  saveEditorialDecision(input: {
    memberId: string;
    candidateId: string;
    expectedRevision: number;
    status: Exclude<OpsEditorialStatus, "PENDING">;
    note: string;
    checks: OpsEditorialDecision["checks"];
    requestId?: string;
  }): Promise<OpsEditorialDecision | null>;
}
