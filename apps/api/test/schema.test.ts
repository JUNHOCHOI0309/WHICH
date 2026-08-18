import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
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
  issueChoices,
  issueVersions,
  issues,
  memberIdentityLinks,
  memberSessions,
  members,
  outboxEvents,
  resultSnapshots,
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
      comments,
      members,
      memberIdentityLinks,
      memberSessions,
      guestMemberLinks,
      commentReactions,
      commentReactionAttempts,
      commentReports,
      commentReportAttempts,
      commentModerationDecisions,
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
      "comments",
      "members",
      "member_identity_links",
      "member_sessions",
      "guest_member_links",
      "comment_reactions",
      "comment_reaction_attempts",
      "comment_reports",
      "comment_report_attempts",
      "comment_moderation_decisions",
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
});
