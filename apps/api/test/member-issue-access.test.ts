import { describe, expect, it } from "vitest";

import { evaluateMemberIssueAccess } from "../src/modules/issues/member-issue-access.js";

const now = new Date("2026-09-02T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1_000);
const report = (subjectId: string, targetKey: string, hours: number) => ({
  subjectId,
  targetKey,
  createdAt: hoursAgo(hours),
});

describe("Member Issue access policy", () => {
  it("keeps access open below the multi-reporter and multi-target thresholds", () => {
    expect(
      evaluateMemberIssueAccess({
        reports: [report("r1", "ISSUE:1", 1), report("r2", "ISSUE:1", 2)],
        recentSubmissionTimes: [],
        now,
      }),
    ).toMatchObject({ state: "OPEN", canCreateNow: true, canStartUpload: true });
  });

  it("limits creation to one question per 24 hours after three reporters cover two targets", () => {
    const access = evaluateMemberIssueAccess({
      reports: [report("r1", "ISSUE:1", 1), report("r2", "ISSUE:1", 2), report("r3", "ISSUE:2", 3)],
      recentSubmissionTimes: [hoursAgo(4)],
      now,
    });
    expect(access).toMatchObject({
      state: "LIMITED",
      canCreateNow: false,
      canStartUpload: true,
      reasonCode: "REPORT_RATE_LIMIT",
    });
    expect(access.restrictedUntil).toBe("2026-09-03T08:00:00.000Z");
  });

  it("blocks new questions and uploads for 72 hours at the hard threshold", () => {
    const access = evaluateMemberIssueAccess({
      reports: [
        report("r1", "ISSUE:1", 7),
        report("r2", "ISSUE:1", 6),
        report("r3", "ISSUE:2", 5),
        report("r4", "ISSUE:2", 4),
        report("r5", "ISSUE_MEDIA:3", 3),
      ],
      recentSubmissionTimes: [],
      now,
    });
    expect(access).toMatchObject({
      state: "BLOCKED",
      canCreateNow: false,
      canStartUpload: false,
      reasonCode: "REPORT_COOLDOWN",
    });
    expect(access.restrictedUntil).toBe("2026-09-05T09:00:00.000Z");
  });

  it("does not let repeated reports from one subject satisfy a reporter threshold", () => {
    expect(
      evaluateMemberIssueAccess({
        reports: [
          report("r1", "ISSUE:1", 1),
          report("r1", "ISSUE:2", 2),
          report("r1", "ISSUE:3", 3),
        ],
        recentSubmissionTimes: [hoursAgo(1)],
        now,
      }),
    ).toMatchObject({ state: "OPEN", canCreateNow: true });
  });
});
