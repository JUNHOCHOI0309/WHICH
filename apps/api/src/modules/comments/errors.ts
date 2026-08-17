export type CommentReadErrorCode = "INVALID_CURSOR" | "VOTE_REQUIRED" | "COMMENTS_UNAVAILABLE";

export class CommentReadError extends Error {
  constructor(
    public readonly code: CommentReadErrorCode,
    public readonly statusCode: 400 | 403 | 409,
    message: string,
  ) {
    super(message);
    this.name = "CommentReadError";
  }
}
