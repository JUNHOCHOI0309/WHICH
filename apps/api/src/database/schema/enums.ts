import { pgEnum } from "drizzle-orm/pg-core";

export const choiceCodeEnum = pgEnum("choice_code", ["A", "B"]);
export const issueLifecycleEnum = pgEnum("issue_lifecycle", [
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
  "RETIRED",
]);
export const issueVisibilityEnum = pgEnum("issue_visibility", [
  "VISIBLE",
  "LIMITED",
  "UNDER_REVIEW",
  "SUSPENDED",
  "REMOVED",
]);
export const issueParticipationEnum = pgEnum("issue_participation", [
  "VOTING_OPEN",
  "VOTING_CHALLENGED",
  "VOTING_SUSPENDED",
  "VOTING_CLOSED",
]);
export const resultVisibilityEnum = pgEnum("result_visibility", [
  "PRE_VOTE_HIDDEN",
  "RESULT_VISIBLE",
  "RESULT_LOCKED",
  "RESULT_DEGRADED",
  "RESULT_UNAVAILABLE",
]);
export const feedEligibilityEnum = pgEnum("feed_eligibility", [
  "ELIGIBLE",
  "DEPRIORITIZED",
  "EXCLUDED",
  "FROZEN",
]);
export const riskLevelEnum = pgEnum("risk_level", ["LOW", "MEDIUM", "HIGH", "RESTRICTED"]);
export const subjectKindEnum = pgEnum("subject_kind", ["GUEST", "MEMBER", "VERIFIED_MEMBER"]);
export const voteRequestStateEnum = pgEnum("vote_request_state", [
  "RECEIVED",
  "VALIDATING",
  "CHALLENGE_REQUIRED",
  "CHALLENGE_PASSED",
  "PROCESSING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
]);
export const voteIntegrityStateEnum = pgEnum("vote_integrity_state", [
  "ACCEPTED",
  "REVIEW",
  "REJECTED_DUPLICATE",
  "REJECTED_ABUSE",
  "INVALIDATED",
]);
export const voteActionEnum = pgEnum("vote_action", [
  "RESTORED",
  "MERGED",
  "RECLASSIFIED",
  "AGGREGATE_REBUILT",
]);
export const resultIntegrityStateEnum = pgEnum("result_integrity_state", [
  "NORMAL",
  "MONITORING",
  "DEGRADED",
  "UNDER_REVIEW",
  "RESULT_LOCKED",
  "CORRECTED",
]);
export const outboxStatusEnum = pgEnum("outbox_status", ["PENDING", "PUBLISHED", "FAILED"]);
