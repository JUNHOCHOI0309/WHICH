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

export interface OpsDashboardService {
  readDashboard(input: {
    memberId: string;
    windowDays: OpsDashboardWindow;
    requestId?: string;
  }): Promise<OpsDashboardSnapshot | null>;
}
