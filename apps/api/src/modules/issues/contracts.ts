export type PublicIssueChoice = {
  id: string;
  code: "A" | "B";
  label: string;
};

export type PublicIssueTally = {
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState:
    "NORMAL" | "MONITORING" | "DEGRADED" | "UNDER_REVIEW" | "RESULT_LOCKED" | "CORRECTED";
};

export type PublicIssue = {
  id: string;
  version: number;
  question: string;
  context: string | null;
  publishedAt: string;
  categoryCode: string;
  experienceModeCode: string;
  choices: PublicIssueChoice[];
  result: {
    visibility:
      | "PRE_VOTE_HIDDEN"
      | "RESULT_VISIBLE"
      | "RESULT_LOCKED"
      | "RESULT_DEGRADED"
      | "RESULT_UNAVAILABLE";
    tally: PublicIssueTally | null;
  };
};

export interface IssueReadService {
  getGuestIssue(issueId: string): Promise<PublicIssue>;
}
