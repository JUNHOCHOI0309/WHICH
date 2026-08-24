export type GuestVoteErrorCode =
  | "GUEST_SUBJECT_NOT_FOUND"
  | "SESSION_REQUIRED"
  | "VOTE_SUBJECT_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_INCOMPLETE"
  | "ISSUE_OR_CHOICE_NOT_FOUND"
  | "ISSUE_NOT_VOTABLE"
  | "ISSUE_VERSION_NOT_FOUND";

export class GuestVoteError extends Error {
  constructor(
    public readonly code: GuestVoteErrorCode,
    public readonly statusCode: 400 | 401 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "GuestVoteError";
  }
}
