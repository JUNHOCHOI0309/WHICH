import type { issues } from "../../database/schema/index.js";

type GuestIssueAvailability = Pick<
  typeof issues.$inferSelect,
  | "lifecycle"
  | "visibility"
  | "participation"
  | "riskLevel"
  | "isPolitical"
  | "voteOpenAt"
  | "voteCloseAt"
>;

export function isGuestIssueAvailable(issue: GuestIssueAvailability, now: Date) {
  const isInsideVoteWindow =
    (!issue.voteOpenAt || issue.voteOpenAt <= now) &&
    (!issue.voteCloseAt || issue.voteCloseAt > now);

  return (
    issue.lifecycle === "PUBLISHED" &&
    issue.visibility === "VISIBLE" &&
    issue.participation === "VOTING_OPEN" &&
    issue.riskLevel === "LOW" &&
    !issue.isPolitical &&
    isInsideVoteWindow
  );
}
