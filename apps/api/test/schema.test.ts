import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  analyticsDailyMetrics,
  analyticsEvents,
  analyticsSessions,
  comments,
  commentModerationDecisions,
  commentModerationActionEnum,
  commentReactionAttempts,
  commentReactionCodeEnum,
  commentReactions,
  commentReportAttempts,
  commentReportReasonEnum,
  commentReports,
  guestMemberLinks,
  interestProfiles,
  issueChoices,
  issueVersions,
  issues,
  memberIdentityLinks,
  memberSessions,
  members,
  outboxEvents,
  operatorAccessGrants,
  operatorAuditLogs,
  operatorBackupConfirmations,
  resultSnapshots,
  subjectInterests,
  voteAggregates,
  voteAttempts,
  voteIntegrityStateEnum,
  voterSubjects,
  votes,
} from "../src/database/schema/index.js";

describe("data architecture v1 schema", () => {
  it("exports the first core-loop tables", () => {
    const tableNames = [
      issues,
      issueVersions,
      issueChoices,
      voterSubjects,
      voteAttempts,
      votes,
      voteAggregates,
      resultSnapshots,
      outboxEvents,
      operatorAccessGrants,
      operatorAuditLogs,
      operatorBackupConfirmations,
      comments,
      members,
      memberIdentityLinks,
      memberSessions,
      guestMemberLinks,
      interestProfiles,
      subjectInterests,
      commentReactions,
      commentReactionAttempts,
      commentReports,
      commentReportAttempts,
      commentModerationDecisions,
      analyticsSessions,
      analyticsEvents,
      analyticsDailyMetrics,
    ].map((table) => getTableConfig(table).name);

    expect(tableNames).toEqual([
      "issues",
      "issue_versions",
      "issue_choices",
      "voter_subjects",
      "vote_attempts",
      "votes",
      "vote_aggregates",
      "result_snapshots",
      "outbox_events",
      "operator_access_grants",
      "operator_audit_logs",
      "operator_backup_confirmations",
      "comments",
      "members",
      "member_identity_links",
      "member_sessions",
      "guest_member_links",
      "interest_profiles",
      "subject_interests",
      "comment_reactions",
      "comment_reaction_attempts",
      "comment_reports",
      "comment_report_attempts",
      "comment_moderation_decisions",
      "analytics_sessions",
      "analytics_events",
      "analytics_daily_metrics",
    ]);
  });

  it("keeps HELPFUL as the single v1 Comment reaction code", () => {
    expect(commentReactionCodeEnum.enumValues).toEqual(["HELPFUL"]);
  });

  it("keeps the fixed v1 Comment report and moderation codes", () => {
    expect(commentReportReasonEnum.enumValues).toEqual([
      "SPAM",
      "HARASSMENT",
      "HATE_OR_ABUSE",
      "PERSONAL_INFORMATION",
      "OTHER",
    ]);
    expect(commentModerationActionEnum.enumValues).toEqual([
      "COLLAPSE",
      "HIDE",
      "REMOVE_POLICY",
      "RESTORE",
    ]);
  });

  it("keeps the canonical vote integrity states", () => {
    expect(voteIntegrityStateEnum.enumValues).toEqual([
      "ACCEPTED",
      "REVIEW",
      "REJECTED_DUPLICATE",
      "REJECTED_ABUSE",
      "INVALIDATED",
    ]);
  });

  it("enforces accepted-vote uniqueness with a partial unique index", () => {
    const acceptedVoteIndex = getTableConfig(votes).indexes.find(
      (index) => index.config.name === "votes_one_accepted_per_issue_subject_unique",
    );

    expect(acceptedVoteIndex?.config.unique).toBe(true);
    expect(acceptedVoteIndex?.config.where).toBeDefined();
  });

  it("keeps Outbox lease and Dead Letter state auditable", () => {
    const config = getTableConfig(outboxEvents);
    const columnNames = config.columns.map((column) => column.name);
    const checkNames = config.checks.map((check) => check.name);

    expect(columnNames).toEqual(
      expect.arrayContaining([
        "attempt_count",
        "total_attempt_count",
        "requeue_count",
        "claim_token",
        "claimed_at",
        "dead_lettered_at",
      ]),
    );
    expect(checkNames).toEqual(
      expect.arrayContaining(["outbox_events_claim_check", "outbox_events_delivery_state_check"]),
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "outbox_events_dead_letter_idx",
    );
  });
});
