import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  comments,
  issueChoices,
  issueVersions,
  issues,
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
