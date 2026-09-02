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

export type OpsReportedMember = {
  memberId: string;
  displayName: string;
  memberStatus: OpsMemberStatus;
  reports7d: number;
  uniqueReporters7d: number;
  reportedTargets7d: number;
  reports14d: number;
  uniqueReporters14d: number;
  reportedTargets14d: number;
  latestReportAt: string;
  issueAccess: {
    policyVersion: string;
    state: "OPEN" | "LIMITED" | "BLOCKED";
    canCreateNow: boolean;
    canStartUpload: boolean;
    reasonCode: null | "REPORT_RATE_LIMIT" | "REPORT_COOLDOWN";
    restrictedUntil: string | null;
  };
};

export type OpsReportedMembersPage = {
  schemaVersion: 1;
  generatedAt: string;
  items: OpsReportedMember[];
};

export type OpsTrustedImagePilotMember = {
  memberId: string;
  displayName: string;
  status: OpsMemberStatus;
  email: string | null;
  createdAt: string;
  metrics: {
    accountAgeDays: number;
    acceptedVotes: number;
    publishedLowRiskIssues: number;
    confirmedViolations90d: number;
  };
  consentCurrent: boolean;
  eligible: boolean;
  eligibilityReasons: string[];
  capability: {
    state: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";
    expiresAt: string;
    reason: string;
  } | null;
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

export type OpsPublishedIssueState = "ACTIVE" | "HIDDEN" | "CLOSED" | "REMOVED";
export type OpsPublishedIssueAction = "HIDE" | "RESTORE" | "REMOVE";
export type OpsPublishedIssue = {
  issueId: string;
  version: number;
  question: string;
  context: string | null;
  choices: Array<{
    id: string;
    code: "A" | "B" | "C" | "D";
    label: string;
    media: null | {
      assetId: string;
      altText: string;
      cropMode: "COVER" | "CONTAIN";
    };
  }>;
  categoryCode: string;
  mediaMode: string;
  author: { memberId: string; displayName: string } | null;
  lifecycle: string;
  visibility: string;
  participation: string;
  feedEligibility: string;
  state: OpsPublishedIssueState;
  acceptedVotes: number;
  reportCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpsPublishedIssuePage = {
  schemaVersion: 1;
  generatedAt: string;
  items: OpsPublishedIssue[];
};

export type OpsPointShopStatus = "ACTIVE" | "PAUSED" | "RETIRED";
export type OpsPointShopEquipSlot = "PROFILE_ACCENT" | "AVATAR_FRAME" | "SHARE_BACKGROUND";
export type OpsPointShopThemeFamily = "SIGNAL_GRID" | "PAPER_VOTE" | "NEON_RIFT" | "SOFT_ORBIT";
export type OpsPointShopItem = {
  id: string;
  code: string;
  equipSlot: OpsPointShopEquipSlot;
  themeFamily: OpsPointShopThemeFamily;
  name: string;
  description: string;
  price: number;
  status: OpsPointShopStatus;
  currentVersion: number;
  opsRevision: number;
  purchaseCount: number;
  createdAt: string;
  updatedAt: string;
};
export type OpsPointShopAuditEntry = {
  id: string;
  eventType: "OPS_POINT_SHOP_ITEM_CREATED" | "OPS_POINT_SHOP_ITEM_UPDATED";
  outcome: "SUCCEEDED" | "FAILED";
  operator: string;
  requestId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
};
export type OpsPointShopView = {
  schemaVersion: 1;
  generatedAt: string;
  counts: Record<OpsPointShopStatus, number>;
  items: OpsPointShopItem[];
  audit: OpsPointShopAuditEntry[];
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
export type OpsMediaRuleFinding = {
  id: string;
  stage: string;
  code: string;
  severity: "INFO" | "REVIEW" | "BLOCK";
  sourceVersion: string;
  evidence: Record<string, unknown>;
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
  findings: OpsMediaRuleFinding[];
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

export type OpsMediaLibraryPair = {
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

export type OpsModerationQueueLane = "HIGH" | "NORMAL" | "RIGHTS" | "APPEAL" | "RANDOM_AUDIT";
export type OpsReviewerAssistLabel = "ALLOW" | "REVIEW" | "BLOCK" | "ABSTAIN";
export type OpsReviewerAssistEvidence = {
  id: string;
  source: "RULE" | "REPORT" | "RIGHTS" | "OCR_QR_PII" | "SAFETY_MODEL" | "SIMILAR_IMAGE";
  code: string;
  severity: "INFO" | "REVIEW" | "BLOCK";
  summary: string;
  sourceVersion: string;
  evidence: Record<string, unknown>;
  regions: Array<{ x: number; y: number; width: number; height: number }>;
};
export type OpsModerationQueueItem = {
  caseId: string;
  expectedRevision: number;
  lane: OpsModerationQueueLane;
  priority: "P0" | "P1" | "P2" | "P3";
  status: string;
  targetType: "ISSUE_MEDIA_ASSET" | "COMMENT_VERSION";
  targetId: string;
  openedAt: string;
  updatedAt: string;
  risky: boolean;
  summary: string;
  cluster: null | { key: string; size: number; targetIds: string[] };
  reviewerAssist: {
    reviewId: string | null;
    requiresProvisionalLabel: boolean;
    provisionalLabel: OpsReviewerAssistLabel | null;
    provisionalRationale: string | null;
    recommendationVisible: boolean;
    recommendation: null | {
      label: OpsReviewerAssistLabel;
      confidence: number | null;
      abstained: boolean;
      disagreement: boolean;
      sources: string[];
    };
    startedAt: string | null;
    aiRevealedAt: string | null;
  };
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
        findings: OpsMediaRuleFinding[];
        evidenceGroups: Record<OpsReviewerAssistEvidence["source"], OpsReviewerAssistEvidence[]>;
        relevance: { supported: boolean; findings: OpsReviewerAssistEvidence[] };
        visualAsymmetry: { supported: boolean; findings: OpsReviewerAssistEvidence[] };
        similarDecisions: Array<{
          assetId: string;
          status: string;
          reasonCode: string;
          rationale: string;
          createdAt: string;
        }>;
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
  operational: {
    provider: {
      mode: "OFF" | "SHADOW";
      provider: "NONE" | "OPENAI_MODERATION";
      killSwitch: boolean;
      canaryPercent: number;
      dailyCallCap: number;
      dailyLimitsEnabled?: boolean;
      dailyCostMicrosCap: number;
      modelSnapshot: string;
      privacyGateAllowed: boolean;
      privacyGateReason: string;
      missingEvidence: string[];
      apiKeyConfigured: boolean;
      circuitWindowMinutes: number;
      circuitMinimumCalls: number;
      circuitFailurePercent: number;
      callsToday: number;
      calls7d: number;
      succeeded7d: number;
      failed7d: number;
      skipped7d: number;
      costMicrosToday: number;
      costMicros7d: number;
      latencyP95Ms: number | null;
      errorRate7d: number;
      cacheHitRate7d: number;
      automationCoverage7d: number;
      circuitState: "CLOSED" | "OPEN";
    };
    worker: {
      pending: number;
      running: number;
      failed: number;
      deadLettered: number;
      oldestPendingAgeSeconds: number | null;
    };
    reconciliation: { mismatches: number; failed: number; repaired7d: number };
    directUploadAllowed: boolean;
    alerts: Array<{ code: string; severity: "WARNING" | "CRITICAL"; message: string }>;
  };
  items: OpsModerationQueueItem[];
};
