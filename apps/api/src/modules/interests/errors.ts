export class InterestProfileError extends Error {
  constructor(
    public readonly code:
      | "SUBJECT_REQUIRED"
      | "GUEST_SUBJECT_NOT_FOUND"
      | "SESSION_INVALID"
      | "INVALID_INTEREST_SELECTION"
      | "GUEST_CANNOT_MERGE"
      | "MERGE_CANDIDATE_NOT_FOUND",
    public readonly statusCode: 400 | 401 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "InterestProfileError";
  }
}
