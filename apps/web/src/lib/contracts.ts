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
  choices: IssueChoice[];
  result: {
    visibility:
      | "PRE_VOTE_HIDDEN"
      | "RESULT_VISIBLE"
      | "RESULT_LOCKED"
      | "RESULT_DEGRADED"
      | "RESULT_UNAVAILABLE";
    tally: IssueTally | null;
  };
};

export type PublicFeedIssue = Omit<PublicIssue, "context" | "experienceModeCode" | "result">;

export type PublicIssueFeed = {
  items: PublicFeedIssue[];
  nextCursor: string | null;
};

export type CommentSide = "ALL" | "A" | "B";

export type PublicComment = {
  id: string;
  choice: "A" | "B";
  author: { displayName: string };
  body: string;
  threadState: "OPEN" | "LOCKED";
  createdAt: string;
  editedAt: string | null;
  reactions: { helpfulCount: number; viewerReacted: boolean };
};

export type PublicCommentPage = {
  items: PublicComment[];
  nextCursor: string | null;
};

export type CommentWriteResponse = { comment: PublicComment };

export type HelpfulReactionResponse = {
  reaction: { code: "HELPFUL"; active: boolean; helpfulCount: number };
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
