export type ShareCardErrorCode =
  "SHARING_DISABLED" | "ISSUE_NOT_SHAREABLE" | "RESULT_SNAPSHOT_NOT_FOUND" | "SHARE_CARD_NOT_FOUND";

export class ShareCardError extends Error {
  constructor(
    public readonly code: ShareCardErrorCode,
    public readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ShareCardError";
  }
}
