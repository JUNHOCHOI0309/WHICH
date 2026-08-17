import { CommentReadError } from "./errors.js";

export type CommentCursor = {
  createdAt: Date;
  commentId: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeCommentCursor(cursor: CommentCursor) {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), commentId: cursor.commentId }),
  ).toString("base64url");
}

export function decodeCommentCursor(value: string): CommentCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      commentId?: unknown;
    };
    const createdAt = new Date(String(parsed.createdAt));

    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(createdAt.valueOf()) ||
      typeof parsed.commentId !== "string" ||
      !uuidPattern.test(parsed.commentId)
    ) {
      throw new Error("Invalid cursor payload");
    }

    return { createdAt, commentId: parsed.commentId };
  } catch {
    throw new CommentReadError("INVALID_CURSOR", 400, "The Comment cursor is invalid.");
  }
}
