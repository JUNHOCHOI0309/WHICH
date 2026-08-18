export type GuestSubject = {
  anonymousSubjectId: string;
};

export type VoteResult = {
  resultVersion: number;
  acceptedA: number;
  acceptedB: number;
  displayedTotal: number;
  integrityState:
    "NORMAL" | "MONITORING" | "DEGRADED" | "UNDER_REVIEW" | "RESULT_LOCKED" | "CORRECTED";
};

export type GuestVoteResponse = {
  outcome: "ACCEPTED" | "REJECTED_DUPLICATE";
  voteAttemptId: string;
  voteId: string;
  issueId: string;
  issueVersion: number;
  choice: "A" | "B";
  result: VoteResult;
};

export type GuestVoteSubmission = {
  idempotencyKey: string;
  anonymousSubjectId: string;
  issueId: string;
  issueVersion: number;
  choiceId: string;
};

export type GuestVoteSubmissionResult = {
  httpStatus: 201 | 409;
  body: GuestVoteResponse;
};

export type VoteReconciliationMode = "DRY_RUN" | "REPAIR";

export type VoteLedgerCounts = {
  voteRequestCount: number;
  acceptedACount: number;
  acceptedBCount: number;
  acceptedVoteCount: number;
  reviewVoteCount: number;
  rejectedDuplicateCount: number;
  rejectedAbuseCount: number;
  invalidatedVoteCount: number;
  displayedVoteCount: number;
};

export type VoteAggregateView = VoteLedgerCounts & {
  resultVersion: number;
  integrityState: VoteResult["integrityState"];
};

export type VoteSnapshotView = {
  resultVersion: number;
  acceptedACount: number;
  acceptedBCount: number;
  displayedVoteCount: number;
  integrityState: VoteResult["integrityState"];
};

export type VoteReconciliationMismatch = {
  target: "SOURCE" | "AGGREGATE" | "LATEST_SNAPSHOT";
  field: string;
  expected: number | string | boolean | null;
  actual: number | string | boolean | null;
};

export type VoteReconciliationResult = {
  issueId: string;
  issueVersion: number;
  mode: VoteReconciliationMode;
  status: "CONSISTENT" | "MISMATCH_FOUND" | "REPAIRED" | "RESULT_LOCKED";
  checkedAt: string;
  source: VoteLedgerCounts;
  aggregateBefore: VoteAggregateView | null;
  latestSnapshotBefore: VoteSnapshotView | null;
  mismatches: VoteReconciliationMismatch[];
  resultAfter: VoteAggregateView | null;
};

export type VoteReconciliationCommand = {
  issueId: string;
  issueVersion: number;
  mode: VoteReconciliationMode;
};

export interface GuestVoteService {
  createGuestSubject(): Promise<GuestSubject>;
  submitGuestVote(command: GuestVoteSubmission): Promise<GuestVoteSubmissionResult>;
  reconcileIssueVersion(command: VoteReconciliationCommand): Promise<VoteReconciliationResult>;
}
