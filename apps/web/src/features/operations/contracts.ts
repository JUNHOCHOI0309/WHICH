export type OpsDashboardSnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  windowDays: 1 | 7 | 30;
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
    stages: Record<"viewable" | "submit" | "accepted" | "result" | "next" | "secondVote", number>;
    rates: Record<
      | "submitPerViewable"
      | "acceptedPerSubmit"
      | "resultPerAccepted"
      | "nextPerResult"
      | "secondVotePerAccepted",
      number
    >;
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
  warnings: Array<{ code: string; severity: "INFO" | "WARNING" | "CRITICAL"; message: string }>;
  runbooks: Array<{ label: string; path: string }>;
};

export type OpsMemberStatus = "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";

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

export type OpsEditorialStatus = "PENDING" | "APPROVED" | "NEEDS_CHANGES" | "REJECTED";
export type OpsEditorialScope = "ACTIVE" | "RESERVE" | "LONG_TERM";

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

export type OpsMediaReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN" | "DELETED";
export type OpsMediaReviewDecision = {
  id: string;
  scope: "ASSET" | "ISSUE";
  assetId: string | null;
  issueId: string | null;
  status: OpsMediaReviewStatus | "RESTORED";
  reasonCode: string;
  rationale: string;
  policyVersion: string;
  reviewedBy: string;
  requestId: string;
  createdAt: string;
};
export type OpsMediaReviewAsset = {
  id: string;
  sha256: string;
  perceptualHash: string | null;
  input: { mimeType: string; byteSize: number; width: number; height: number };
  output: { mimeType: "image/webp"; byteSize: number; width: number; height: number };
  effectiveStatus: OpsMediaReviewStatus;
  rightsState: "ASSERTED" | "CHALLENGED" | "CLEARED" | "WITHDRAWN";
  rightsAttestation: string;
  rightsAttestedAt: string;
  uploadedBy: string;
  publishedUrl: string | null;
  link: null | {
    issueId: string;
    issueVersion: number;
    choiceId: string;
    choiceCode: string;
    choiceLabel: string;
    question: string;
    altText: string;
  };
  latestDecision: OpsMediaReviewDecision | null;
  history: OpsMediaReviewDecision[];
  createdAt: string;
  updatedAt: string;
};
export type OpsMediaReviewPage = {
  schemaVersion: 1;
  generatedAt: string;
  counts: Record<OpsMediaReviewStatus, number>;
  items: OpsMediaReviewAsset[];
};
export type OpsMediaRightsRequest = {
  id: string;
  requestType: "PRIVACY" | "DEFAMATION" | "COPYRIGHT";
  assetId: string | null;
  issueId: string | null;
  requesterReference: string;
  details: string;
  status: "OPEN" | "ACTIONED" | "DISMISSED";
  resolution: string | null;
  recordedBy: string;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
};
