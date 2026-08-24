export type IssueReadErrorCode =
  "INVALID_CURSOR" | "STALE_RANKING_CURSOR" | "ISSUE_NOT_FOUND" | "ISSUE_NOT_AVAILABLE";

export class IssueReadError extends Error {
  constructor(
    public readonly code: IssueReadErrorCode,
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "IssueReadError";
  }
}

export type IssueWriteErrorCode =
  | "SESSION_REQUIRED"
  | "INVALID_ISSUE_CONTENT"
  | "UNSAFE_ISSUE_CONTENT"
  | "ISSUE_CREATION_LIMIT_REACHED"
  | "IDEMPOTENCY_CONFLICT";

export class IssueWriteError extends Error {
  constructor(
    public readonly code: IssueWriteErrorCode,
    public readonly statusCode: 400 | 401 | 409 | 422 | 429,
    message: string,
  ) {
    super(message);
    this.name = "IssueWriteError";
  }
}
