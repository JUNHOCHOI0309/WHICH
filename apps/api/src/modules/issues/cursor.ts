import { IssueReadError } from "./errors.js";

export type IssueFeedCursor = {
  publishedAt: Date;
  issueId: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeIssueFeedCursor(cursor: IssueFeedCursor) {
  return Buffer.from(
    JSON.stringify({ publishedAt: cursor.publishedAt.toISOString(), issueId: cursor.issueId }),
  ).toString("base64url");
}

export function decodeIssueFeedCursor(value: string): IssueFeedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      publishedAt?: unknown;
      issueId?: unknown;
    };
    const publishedAt = new Date(String(parsed.publishedAt));

    if (
      typeof parsed.publishedAt !== "string" ||
      Number.isNaN(publishedAt.valueOf()) ||
      typeof parsed.issueId !== "string" ||
      !uuidPattern.test(parsed.issueId)
    ) {
      throw new Error("Invalid cursor payload");
    }

    return { publishedAt, issueId: parsed.issueId };
  } catch {
    throw new IssueReadError("INVALID_CURSOR", 400, "The Issue feed cursor is invalid.");
  }
}
