export type IssueReadErrorCode = "INVALID_CURSOR" | "ISSUE_NOT_FOUND" | "ISSUE_NOT_AVAILABLE";

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
