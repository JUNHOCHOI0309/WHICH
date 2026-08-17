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

export interface GuestVoteService {
  createGuestSubject(): Promise<GuestSubject>;
  submitGuestVote(command: GuestVoteSubmission): Promise<GuestVoteSubmissionResult>;
}
