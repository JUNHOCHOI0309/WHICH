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
  | "ISSUE_SUBMISSION_NOT_FOUND"
  | "ISSUE_SUBMISSION_REVISION_CONFLICT"
  | "ISSUE_SUBMISSION_NOT_EDITABLE"
  | "ISSUE_SUBMISSION_MEDIA_INVALID"
  | "ISSUE_LIBRARY_PAIR_UNAVAILABLE"
  | "ISSUE_LIBRARY_ASSET_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT";

export class IssueWriteError extends Error {
  constructor(
    public readonly code: IssueWriteErrorCode,
    public readonly statusCode: 400 | 401 | 404 | 409 | 422 | 429,
    message: string,
  ) {
    super(message);
    this.name = "IssueWriteError";
  }
}
