export type IssueChoice = {
  id: string;
  code: "A" | "B";
  label: string;
};

export type IssueTally = {
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState: string;
};

export type PublicFeedIssue = {
  id: string;
  version: number;
  question: string;
  publishedAt: string;
  categoryCode: string;
  choices: IssueChoice[];
};

export type PublicIssue = PublicFeedIssue & {
  context: string | null;
  experienceModeCode: string;
  result: {
    visibility: string;
    tally: IssueTally | null;
  };
};

export type PublicIssueFeed = {
  items: PublicFeedIssue[];
  nextCursor: string | null;
};

export type VoteResponse = {
  outcome: "ACCEPTED" | "REJECTED_DUPLICATE";
  voteAttemptId: string;
  voteId: string;
  issueId: string;
  issueVersion: number;
  choice: "A" | "B";
  result: IssueTally;
};

export type ApiErrorBody = {
  code: string;
  message: string;
};
