import { CommentReadError } from "./errors.js";

export type CommentCursor = {
  sort: "NEWEST" | "HELPFUL";
  createdAt: Date;
  commentId: string;
  helpfulCount?: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeCommentCursor(cursor: CommentCursor) {
  return Buffer.from(
    JSON.stringify({
      sort: cursor.sort,
      createdAt: cursor.createdAt.toISOString(),
      commentId: cursor.commentId,
      helpfulCount: cursor.helpfulCount,
    }),
  ).toString("base64url");
}

export function decodeCommentCursor(value: string): CommentCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      commentId?: unknown;
      sort?: unknown;
      helpfulCount?: unknown;
    };
    const createdAt = new Date(String(parsed.createdAt));

    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(createdAt.valueOf()) ||
      typeof parsed.commentId !== "string" ||
      !uuidPattern.test(parsed.commentId) ||
      (parsed.sort !== undefined && parsed.sort !== "NEWEST" && parsed.sort !== "HELPFUL") ||
      (parsed.sort === "HELPFUL" &&
        (!Number.isInteger(parsed.helpfulCount) || Number(parsed.helpfulCount) < 0))
    ) {
      throw new Error("Invalid cursor payload");
    }

    return {
      sort: parsed.sort === "HELPFUL" ? "HELPFUL" : "NEWEST",
      createdAt,
      commentId: parsed.commentId,
      helpfulCount: parsed.sort === "HELPFUL" ? Number(parsed.helpfulCount) : undefined,
    };
  } catch {
    throw new CommentReadError("INVALID_CURSOR", 400, "The Comment cursor is invalid.");
  }
}
