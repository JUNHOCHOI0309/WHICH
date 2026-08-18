export type CommentErrorCode =
  | "INVALID_CURSOR"
  | "VOTE_REQUIRED"
  | "COMMENTS_UNAVAILABLE"
  | "SESSION_REQUIRED"
  | "COMMENT_ALREADY_EXISTS"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_INCOMPLETE"
  | "COMMENT_TOO_SHORT"
  | "COMMENT_TOO_LONG"
  | "COMMENT_URL_NOT_ALLOWED"
  | "COMMENT_CONTROL_CHARACTER"
  | "COMMENT_SPAM_PATTERN"
  | "REACTION_SUBJECT_REQUIRED"
  | "REACTION_UNAVAILABLE";

export class CommentError extends Error {
  constructor(
    public readonly code: CommentErrorCode,
    public readonly statusCode: 400 | 401 | 403 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "CommentError";
  }
}

export { CommentError as CommentReadError };
