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
export const memberStatusEnum = pgEnum("member_status", [
  "ACTIVE",
  "LIMITED",
  "SUSPENDED",
  "DELETED",
]);
export const profileVisibilityEnum = pgEnum("profile_visibility", ["PRIVATE", "PUBLIC"]);
export const identityProviderEnum = pgEnum("identity_provider", [
  "GOOGLE",
  "X",
  "NAVER",
  "KAKAO",
  "DEVELOPMENT",
]);
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
export const commentPublicationStateEnum = pgEnum("comment_publication_state", [
  "PENDING_AUTOMOD",
  "PENDING_HUMAN_REVIEW",
  "PUBLISHED",
  "FAILED",
]);
export const commentVisibilityEnum = pgEnum("comment_visibility", [
  "VISIBLE",
  "DEPRIORITIZED",
  "COLLAPSED",
  "HIDDEN",
  "REMOVED_BY_AUTHOR",
  "REMOVED_POLICY",
]);
export const commentThreadStateEnum = pgEnum("comment_thread_state", ["OPEN", "LOCKED"]);
export const commentIntegrityStateEnum = pgEnum("comment_integrity_state", [
  "NORMAL",
  "REVIEW",
  "REJECTED",
  "INVALIDATED",
]);
export const commentReactionCodeEnum = pgEnum("comment_reaction_code", ["HELPFUL"]);
export const commentReportReasonEnum = pgEnum("comment_report_reason", [
  "SPAM",
  "HARASSMENT",
  "HATE_OR_ABUSE",
  "PERSONAL_INFORMATION",
  "OTHER",
]);
export const commentModerationActionEnum = pgEnum("comment_moderation_action", [
  "COLLAPSE",
  "HIDE",
  "REMOVE_POLICY",
  "RESTORE",
]);
export const commentModerationSourceEnum = pgEnum("comment_moderation_source", [
  "SYSTEM_AUTOMATION",
  "INTERNAL_MODERATOR",
]);
