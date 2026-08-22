import { MemberIdentityError } from "./errors.js";

export type MemberVoteHistoryCursor = {
  acceptedAt: Date;
  voteId: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeMemberVoteHistoryCursor(cursor: MemberVoteHistoryCursor) {
  return Buffer.from(
    JSON.stringify({ acceptedAt: cursor.acceptedAt.toISOString(), voteId: cursor.voteId }),
  ).toString("base64url");
}

export function decodeMemberVoteHistoryCursor(value: string): MemberVoteHistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      acceptedAt?: unknown;
      voteId?: unknown;
    };
    const acceptedAt = new Date(String(parsed.acceptedAt));

    if (
      typeof parsed.acceptedAt !== "string" ||
      Number.isNaN(acceptedAt.valueOf()) ||
      typeof parsed.voteId !== "string" ||
      !uuidPattern.test(parsed.voteId)
    ) {
      throw new Error("Invalid cursor payload");
    }

    return { acceptedAt, voteId: parsed.voteId };
  } catch {
    throw new MemberIdentityError(
      "INVALID_CURSOR",
      400,
      "The Member vote history cursor is invalid.",
    );
  }
}
