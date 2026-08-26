import { describe, expect, it } from "vitest";

import {
  evaluateTrustedImagePilot,
  evaluateTrustedUploaderEligibility,
  type TrustedImagePilotEvidence,
} from "../src/modules/issue-media/trusted-uploader-policy.js";

const eligibleMember = {
  memberStatus: "ACTIVE" as const,
  hasVerifiedEmail: true,
  accountAgeDays: 45,
  acceptedVoteCount: 30,
  publishedLowRiskIssueCount: 4,
  confirmedViolationCountInLookback: 0,
  hasActiveRestriction: false,
  acceptedCurrentRightsTerms: true,
};

const healthyPilot: TrustedImagePilotEvidence = {
  observationDays: 21,
  distinctUploaders: 12,
  submittedAssets: 60,
  reviewedAssets: 55,
  rejectedAssets: 8,
  publishedAssets: 47,
  reportedPublishedAssets: 0,
  rightsRequests: 0,
  seriousSafetyOrPrivacyMisses: 0,
  resolvedAppeals: 3,
  overturnedAppeals: 0,
  reviewP95Hours: 12,
  oldestPendingHours: 18,
  medianReviewMinutes: 3,
  weeklyOperationsHours: 2.5,
};

describe("trusted Issue image uploader policy", () => {
  it("requires every eligibility gate and does not infer capability from Member status", () => {
    expect(evaluateTrustedUploaderEligibility(eligibleMember)).toEqual({
      eligible: true,
      reasons: [],
    });

    expect(
      evaluateTrustedUploaderEligibility({
        ...eligibleMember,
        hasVerifiedEmail: false,
        confirmedViolationCountInLookback: 1,
        acceptedCurrentRightsTerms: false,
      }),
    ).toEqual({
      eligible: false,
      reasons: ["EMAIL_NOT_VERIFIED", "RECENT_CONFIRMED_VIOLATION", "RIGHTS_TERMS_NOT_ACCEPTED"],
    });
  });

  it("keeps the Pilot inconclusive until the minimum observation sample exists", () => {
    expect(
      evaluateTrustedImagePilot({
        ...healthyPilot,
        observationDays: 7,
        distinctUploaders: 4,
        submittedAssets: 12,
      }),
    ).toMatchObject({
      decision: "INSUFFICIENT_EVIDENCE",
      reasons: ["OBSERVATION_PERIOD_TOO_SHORT", "TOO_FEW_UPLOADERS", "TOO_FEW_ASSETS"],
    });
  });

  it("returns GO when safety, quality, SLA, and solo-operator cost gates pass", () => {
    expect(evaluateTrustedImagePilot(healthyPilot)).toMatchObject({
      decision: "GO",
      reasons: [],
    });
  });

  it("returns HOLD for correctable quality drift without a hard-stop incident", () => {
    expect(
      evaluateTrustedImagePilot({
        ...healthyPilot,
        rejectedAssets: 20,
        reportedPublishedAssets: 1,
        resolvedAppeals: 5,
        overturnedAppeals: 1,
        medianReviewMinutes: 6,
      }),
    ).toMatchObject({
      decision: "HOLD",
      reasons: [
        "REJECT_RATE_HIGH",
        "REPORT_RATE_HIGH",
        "APPEAL_OVERTURN_RATE_HIGH",
        "REVIEW_TIME_HIGH",
      ],
    });
  });

  it("returns NO_GO for a serious miss, SLA breach, rights burden, or excess operations cost", () => {
    expect(
      evaluateTrustedImagePilot({
        ...healthyPilot,
        rightsRequests: 1,
        seriousSafetyOrPrivacyMisses: 1,
        reviewP95Hours: 30,
        oldestPendingHours: 60,
        weeklyOperationsHours: 5,
      }),
    ).toMatchObject({
      decision: "NO_GO",
      reasons: [
        "SERIOUS_SAFETY_OR_PRIVACY_MISS",
        "REVIEW_SLA_BREACH",
        "QUEUE_AGE_BREACH",
        "RIGHTS_REQUEST_RATE_HIGH",
        "OPERATIONS_COST_HIGH",
      ],
    });
  });
});
