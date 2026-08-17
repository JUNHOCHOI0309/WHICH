export type IssueReadErrorCode = "ISSUE_NOT_FOUND" | "ISSUE_NOT_AVAILABLE";

export class IssueReadError extends Error {
  constructor(
    public readonly code: IssueReadErrorCode,
    public readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "IssueReadError";
  }
}
