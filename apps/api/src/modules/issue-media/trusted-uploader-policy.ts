export const TRUSTED_IMAGE_UPLOADER_POLICY_VERSION = "which-trusted-image-uploader-v1";

export const TRUSTED_IMAGE_UPLOADER_LIMITS = {
  minimumAccountAgeDays: 30,
  minimumAcceptedVotes: 20,
  minimumPublishedLowRiskIssues: 3,
  violationLookbackDays: 90,
  grantDurationDays: 30,
  dailyUploadLimit: 3,
  maximumOpenAssets: 10,
} as const;

export type TrustedUploaderEligibilityInput = {
  memberStatus: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
  hasVerifiedEmail: boolean;
  accountAgeDays: number;
  acceptedVoteCount: number;
  publishedLowRiskIssueCount: number;
  confirmedViolationCountInLookback: number;
  hasActiveRestriction: boolean;
  acceptedCurrentRightsTerms: boolean;
};

export type TrustedUploaderEligibilityReason =
  | "MEMBER_NOT_ACTIVE"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_TOO_NEW"
  | "INSUFFICIENT_HEALTHY_ACTIVITY"
  | "INSUFFICIENT_PUBLISHED_ISSUES"
  | "RECENT_CONFIRMED_VIOLATION"
  | "ACTIVE_RESTRICTION"
  | "RIGHTS_TERMS_NOT_ACCEPTED";

export function evaluateTrustedUploaderEligibility(input: TrustedUploaderEligibilityInput): {
  eligible: boolean;
  reasons: TrustedUploaderEligibilityReason[];
} {
  const reasons: TrustedUploaderEligibilityReason[] = [];

  if (input.memberStatus !== "ACTIVE") reasons.push("MEMBER_NOT_ACTIVE");
  if (!input.hasVerifiedEmail) reasons.push("EMAIL_NOT_VERIFIED");
  if (input.accountAgeDays < TRUSTED_IMAGE_UPLOADER_LIMITS.minimumAccountAgeDays) {
    reasons.push("ACCOUNT_TOO_NEW");
  }
  if (input.acceptedVoteCount < TRUSTED_IMAGE_UPLOADER_LIMITS.minimumAcceptedVotes) {
    reasons.push("INSUFFICIENT_HEALTHY_ACTIVITY");
  }
  if (
    input.publishedLowRiskIssueCount < TRUSTED_IMAGE_UPLOADER_LIMITS.minimumPublishedLowRiskIssues
  ) {
    reasons.push("INSUFFICIENT_PUBLISHED_ISSUES");
  }
  if (input.confirmedViolationCountInLookback > 0) {
    reasons.push("RECENT_CONFIRMED_VIOLATION");
  }
  if (input.hasActiveRestriction) reasons.push("ACTIVE_RESTRICTION");
  if (!input.acceptedCurrentRightsTerms) reasons.push("RIGHTS_TERMS_NOT_ACCEPTED");

  return { eligible: reasons.length === 0, reasons };
}

export const TRUSTED_IMAGE_PILOT_GATES = {
  minimumObservationDays: 14,
  minimumDistinctUploaders: 10,
  minimumSubmittedAssets: 30,
  maximumReviewP95Hours: 24,
  maximumOldestPendingHours: 48,
  maximumRejectRate: 0.3,
  maximumPublishedReportRate: 0.02,
  maximumRightsRequestRate: 0.01,
  maximumAppealOverturnRate: 0.1,
  maximumMedianReviewMinutes: 5,
  maximumWeeklyOperationsHours: 4,
} as const;

export type TrustedImagePilotEvidence = {
  observationDays: number;
  distinctUploaders: number;
  submittedAssets: number;
  reviewedAssets: number;
  rejectedAssets: number;
  publishedAssets: number;
  reportedPublishedAssets: number;
  rightsRequests: number;
  seriousSafetyOrPrivacyMisses: number;
  resolvedAppeals: number;
  overturnedAppeals: number;
  reviewP95Hours: number;
  oldestPendingHours: number;
  medianReviewMinutes: number;
  weeklyOperationsHours: number;
};

export type TrustedImagePilotDecision = "INSUFFICIENT_EVIDENCE" | "GO" | "HOLD" | "NO_GO";

export type TrustedImagePilotReason =
  | "OBSERVATION_PERIOD_TOO_SHORT"
  | "TOO_FEW_UPLOADERS"
  | "TOO_FEW_ASSETS"
  | "SERIOUS_SAFETY_OR_PRIVACY_MISS"
  | "REVIEW_SLA_BREACH"
  | "QUEUE_AGE_BREACH"
  | "REJECT_RATE_HIGH"
  | "REPORT_RATE_HIGH"
  | "RIGHTS_REQUEST_RATE_HIGH"
  | "APPEAL_OVERTURN_RATE_HIGH"
  | "REVIEW_TIME_HIGH"
  | "OPERATIONS_COST_HIGH";

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function evaluateTrustedImagePilot(evidence: TrustedImagePilotEvidence): {
  decision: TrustedImagePilotDecision;
  reasons: TrustedImagePilotReason[];
  rates: {
    rejectRate: number;
    reportRate: number;
    rightsRequestRate: number;
    appealOverturnRate: number;
  };
} {
  const rates = {
    rejectRate: ratio(evidence.rejectedAssets, evidence.reviewedAssets),
    reportRate: ratio(evidence.reportedPublishedAssets, evidence.publishedAssets),
    rightsRequestRate: ratio(evidence.rightsRequests, evidence.publishedAssets),
    appealOverturnRate: ratio(evidence.overturnedAppeals, evidence.resolvedAppeals),
  };
  const insufficientReasons: TrustedImagePilotReason[] = [];

  if (evidence.observationDays < TRUSTED_IMAGE_PILOT_GATES.minimumObservationDays) {
    insufficientReasons.push("OBSERVATION_PERIOD_TOO_SHORT");
  }
  if (evidence.distinctUploaders < TRUSTED_IMAGE_PILOT_GATES.minimumDistinctUploaders) {
    insufficientReasons.push("TOO_FEW_UPLOADERS");
  }
  if (evidence.submittedAssets < TRUSTED_IMAGE_PILOT_GATES.minimumSubmittedAssets) {
    insufficientReasons.push("TOO_FEW_ASSETS");
  }
  if (insufficientReasons.length > 0) {
    return { decision: "INSUFFICIENT_EVIDENCE", reasons: insufficientReasons, rates };
  }

  const noGoReasons: TrustedImagePilotReason[] = [];
  if (evidence.seriousSafetyOrPrivacyMisses > 0) {
    noGoReasons.push("SERIOUS_SAFETY_OR_PRIVACY_MISS");
  }
  if (evidence.reviewP95Hours > TRUSTED_IMAGE_PILOT_GATES.maximumReviewP95Hours) {
    noGoReasons.push("REVIEW_SLA_BREACH");
  }
  if (evidence.oldestPendingHours > TRUSTED_IMAGE_PILOT_GATES.maximumOldestPendingHours) {
    noGoReasons.push("QUEUE_AGE_BREACH");
  }
  if (rates.rightsRequestRate > TRUSTED_IMAGE_PILOT_GATES.maximumRightsRequestRate) {
    noGoReasons.push("RIGHTS_REQUEST_RATE_HIGH");
  }
  if (evidence.weeklyOperationsHours > TRUSTED_IMAGE_PILOT_GATES.maximumWeeklyOperationsHours) {
    noGoReasons.push("OPERATIONS_COST_HIGH");
  }
  if (noGoReasons.length > 0) {
    return { decision: "NO_GO", reasons: noGoReasons, rates };
  }

  const holdReasons: TrustedImagePilotReason[] = [];
  if (rates.rejectRate > TRUSTED_IMAGE_PILOT_GATES.maximumRejectRate) {
    holdReasons.push("REJECT_RATE_HIGH");
  }
  if (rates.reportRate > TRUSTED_IMAGE_PILOT_GATES.maximumPublishedReportRate) {
    holdReasons.push("REPORT_RATE_HIGH");
  }
  if (rates.appealOverturnRate > TRUSTED_IMAGE_PILOT_GATES.maximumAppealOverturnRate) {
    holdReasons.push("APPEAL_OVERTURN_RATE_HIGH");
  }
  if (evidence.medianReviewMinutes > TRUSTED_IMAGE_PILOT_GATES.maximumMedianReviewMinutes) {
    holdReasons.push("REVIEW_TIME_HIGH");
  }

  return {
    decision: holdReasons.length === 0 ? "GO" : "HOLD",
    reasons: holdReasons,
    rates,
  };
}
