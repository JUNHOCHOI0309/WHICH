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
  contentReportAttempts,
  contentReports,
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
  operatorEditorialDecisions,
  operatorBackupConfirmations,
  pointAccounts,
  pointDailyCounters,
  pointLedgerEntries,
  pointLedgerEntryTypeEnum,
  resultSnapshots,
  reportCases,
  reportClusters,
  reporterSignalSnapshots,
  reportSignalSnapshots,
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
      operatorEditorialDecisions,
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
      "operator_editorial_decisions",
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

  it("keeps the supported Comment reaction codes explicit", () => {
    expect(commentReactionCodeEnum.enumValues).toEqual(["HELPFUL", "DISLIKE"]);
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

  it("keeps report cases, clusters, and reporter Signals explicit and shadow-only", () => {
    expect(
      [
        reportCases,
        reportClusters,
        contentReports,
        contentReportAttempts,
        reportSignalSnapshots,
        reporterSignalSnapshots,
      ].map((table) => getTableConfig(table).name),
    ).toEqual([
      "report_cases",
      "report_clusters",
      "content_reports",
      "content_report_attempts",
      "report_signal_snapshots",
      "reporter_signal_snapshots",
    ]);
    expect(getTableConfig(reportSignalSnapshots).checks.map((check) => check.name)).toContain(
      "report_signal_snapshots_shadow_check",
    );
    expect(getTableConfig(reporterSignalSnapshots).checks.map((check) => check.name)).toContain(
      "reporter_signal_snapshots_shadow_check",
    );
  });

  it("keeps the point ledger source of truth constrained and auditable", () => {
    expect(pointLedgerEntryTypeEnum.enumValues).toEqual([
      "EARN",
      "SPEND",
      "REFUND",
      "REVERSAL",
      "ADJUSTMENT",
    ]);

    const accountConfig = getTableConfig(pointAccounts);
    const ledgerConfig = getTableConfig(pointLedgerEntries);
    const counterConfig = getTableConfig(pointDailyCounters);

    expect(accountConfig.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "point_accounts_balance_nonnegative_check",
        "point_accounts_lifetime_earned_check",
        "point_accounts_lifetime_spent_check",
      ]),
    );
    expect(ledgerConfig.uniqueConstraints.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "point_ledger_entries_idempotency_key_unique",
        "point_ledger_entries_source_reason_unique",
      ]),
    );
    expect(ledgerConfig.indexes.map((index) => index.config.name)).toContain(
      "point_ledger_entries_reversal_unique",
    );
    expect(counterConfig.primaryKeys.map((primaryKey) => primaryKey.getName())).toContain(
      "point_daily_counters_pk",
    );
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
