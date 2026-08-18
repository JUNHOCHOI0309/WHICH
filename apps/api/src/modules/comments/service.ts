import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  comments,
  commentWriteAttempts,
  guestMemberLinks,
  issueChoices,
  issues,
  memberSessions,
  members,
  outboxEvents,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import type {
  CommentService,
  MemberCommentSubmission,
  MemberCommentSubmissionResult,
  PublicComment,
} from "./contracts.js";
import { decodeCommentCursor, encodeCommentCursor } from "./cursor.js";
import { CommentError } from "./errors.js";

const TEXT_POLICY_VERSION = "comment-text-v1";
const EVENT_SCHEMA_VERSION = 1;

type EligibleVote = { id: string; issueVersion: number; choice: "A" | "B" };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeCommentBody(value: string) {
  const body = value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  const length = Array.from(body).length;

  if (length < 2) {
    throw new CommentError(
      "COMMENT_TOO_SHORT",
      422,
      "Comment text must contain at least 2 characters.",
    );
  }
  if (length > 500) {
    throw new CommentError(
      "COMMENT_TOO_LONG",
      422,
      "Comment text must contain at most 500 characters.",
    );
  }
  const containsControlCharacter = Array.from(body).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 9 || (codePoint >= 11 && codePoint <= 31) || codePoint === 127;
  });
  if (containsControlCharacter) {
    throw new CommentError(
      "COMMENT_CONTROL_CHARACTER",
      422,
      "Comment text contains an unsupported control character.",
    );
  }
  if (/(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+(?:com|net|org|io|kr)\b)/iu.test(body)) {
    throw new CommentError("COMMENT_URL_NOT_ALLOWED", 422, "URLs are not allowed in Comments.");
  }
  if (
    (body.match(/\n/g)?.length ?? 0) > 8 ||
    /(.)\1{8,}/u.test(body) ||
    /(\S{2,10})(?:\1){4,}/u.test(body)
  ) {
    throw new CommentError(
      "COMMENT_SPAM_PATTERN",
      422,
      "Comment text contains an unsupported repetition pattern.",
    );
  }

  return body;
}

function fingerprint(
  command: Pick<MemberCommentSubmission, "idempotencyKey" | "issueId">,
  memberId: string,
  body: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([command.idempotencyKey, memberId, command.issueId, body]))
    .digest("hex");
}

function isStoredCommentResponse(value: unknown): value is MemberCommentSubmissionResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MemberCommentSubmissionResult>;
  return (
    candidate.httpStatus === 201 &&
    typeof candidate.body === "object" &&
    candidate.body !== null &&
    typeof candidate.body.comment?.id === "string"
  );
}

function toPublicComment(row: typeof comments.$inferSelect): PublicComment {
  return {
    id: row.id,
    choice: row.choice,
    author: { displayName: row.authorDisplayName },
    body: row.body,
    threadState: row.threadState,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

function commentsAvailable(issue: {
  lifecycle: string;
  visibility: string;
  resultVisibility: string;
  riskLevel: string;
  isPolitical: boolean;
}) {
  return (
    ["PUBLISHED", "CLOSED", "ARCHIVED"].includes(issue.lifecycle) &&
    issue.visibility === "VISIBLE" &&
    ["PRE_VOTE_HIDDEN", "RESULT_VISIBLE"].includes(issue.resultVisibility) &&
    issue.riskLevel === "LOW" &&
    !issue.isPolitical
  );
}

export function createCommentService(database: Database["db"]): CommentService {
  return {
    async listGuestComments(query) {
      const cursor = query.cursor ? decodeCommentCursor(query.cursor) : null;

      return database.transaction(async (transaction) => {
        if (!query.anonymousSubjectId) {
          throw new CommentError(
            "VOTE_REQUIRED",
            403,
            "An accepted Vote is required before reading Comments.",
          );
        }

        const [subject] = await transaction
          .select({ id: voterSubjects.id })
          .from(voterSubjects)
          .where(eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId))
          .limit(1);

        if (!subject) {
          throw new CommentError(
            "VOTE_REQUIRED",
            403,
            "An accepted Vote is required before reading Comments.",
          );
        }

        const [acceptedVote] = await transaction
          .select({ issueVersion: votes.issueVersion })
          .from(votes)
          .where(
            and(
              eq(votes.issueId, query.issueId),
              eq(votes.subjectId, subject.id),
              eq(votes.integrityState, "ACCEPTED"),
            ),
          )
          .limit(1);

        if (!acceptedVote) {
          throw new CommentError(
            "VOTE_REQUIRED",
            403,
            "An accepted Vote is required before reading Comments.",
          );
        }

        const [issue] = await transaction
          .select({
            lifecycle: issues.lifecycle,
            visibility: issues.visibility,
            resultVisibility: issues.resultVisibility,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
          })
          .from(issues)
          .where(eq(issues.id, query.issueId))
          .limit(1);

        if (!issue || !commentsAvailable(issue)) {
          throw new CommentError(
            "COMMENTS_UNAVAILABLE",
            409,
            "Comments are not publicly available for this Issue.",
          );
        }

        const filters: SQL[] = [
          eq(comments.issueId, query.issueId),
          eq(comments.issueVersion, acceptedVote.issueVersion),
          isNull(comments.parentCommentId),
          eq(comments.publicationState, "PUBLISHED"),
          inArray(comments.visibility, ["VISIBLE", "DEPRIORITIZED"]),
          eq(comments.integrityState, "NORMAL"),
          isNull(comments.deletedAt),
        ];

        if (query.side !== "ALL") filters.push(eq(comments.choice, query.side));
        if (cursor) {
          filters.push(
            or(
              lt(comments.createdAt, cursor.createdAt),
              and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.commentId)),
            )!,
          );
        }

        const rows = await transaction
          .select()
          .from(comments)
          .where(and(...filters))
          .orderBy(desc(comments.createdAt), desc(comments.id))
          .limit(query.limit + 1);

        const hasMore = rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const lastItem = pageRows.at(-1);

        return {
          items: pageRows.map(toPublicComment),
          nextCursor:
            hasMore && lastItem
              ? encodeCommentCursor({ createdAt: lastItem.createdAt, commentId: lastItem.id })
              : null,
        };
      });
    },

    async submitMemberComment(command) {
      const body = normalizeCommentBody(command.body);
      const now = new Date();

      return database.transaction(async (transaction) => {
        const [session] = await transaction
          .select({ memberId: members.id, displayName: members.displayName })
          .from(memberSessions)
          .innerJoin(members, eq(memberSessions.memberId, members.id))
          .where(
            and(
              eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
              isNull(memberSessions.revokedAt),
              gt(memberSessions.expiresAt, now),
              eq(members.status, "ACTIVE"),
            ),
          )
          .limit(1);

        if (!session) {
          throw new CommentError("SESSION_REQUIRED", 401, "An active Member session is required.");
        }

        const requestFingerprint = fingerprint(command, session.memberId, body);
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`,
        );

        const [existingAttempt] = await transaction
          .select({
            memberId: commentWriteAttempts.memberId,
            requestFingerprint: commentWriteAttempts.requestFingerprint,
            responseSnapshot: commentWriteAttempts.responseSnapshot,
          })
          .from(commentWriteAttempts)
          .where(eq(commentWriteAttempts.id, command.idempotencyKey))
          .limit(1);

        if (existingAttempt) {
          if (
            existingAttempt.memberId !== session.memberId ||
            existingAttempt.requestFingerprint !== requestFingerprint
          ) {
            throw new CommentError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "The Idempotency-Key was already used for a different Comment request.",
            );
          }
          if (!isStoredCommentResponse(existingAttempt.responseSnapshot)) {
            throw new CommentError(
              "IDEMPOTENCY_INCOMPLETE",
              409,
              "The original Comment request has not reached a reusable result.",
            );
          }
          return existingAttempt.responseSnapshot;
        }

        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${session.memberId}:${command.issueId}`}, 0))`,
        );

        const [authorSubject] = await transaction
          .select({ id: voterSubjects.id })
          .from(voterSubjects)
          .where(and(eq(voterSubjects.kind, "MEMBER"), eq(voterSubjects.userId, session.memberId)))
          .limit(1);
        if (!authorSubject) throw new Error("Member voter subject is missing.");

        const [existingComment] = await transaction
          .select({ id: comments.id })
          .from(comments)
          .where(
            and(
              eq(comments.issueId, command.issueId),
              eq(comments.authorSubjectId, authorSubject.id),
              isNull(comments.parentCommentId),
              isNull(comments.deletedAt),
            ),
          )
          .limit(1);
        if (existingComment) {
          throw new CommentError(
            "COMMENT_ALREADY_EXISTS",
            409,
            "This Member already has a Comment on the Issue.",
          );
        }

        const [directVote] = await transaction
          .select({ id: votes.id, issueVersion: votes.issueVersion, choice: issueChoices.code })
          .from(votes)
          .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
          .where(
            and(
              eq(votes.issueId, command.issueId),
              eq(votes.subjectId, authorSubject.id),
              eq(votes.integrityState, "ACCEPTED"),
            ),
          )
          .orderBy(asc(votes.acceptedAt), asc(votes.id))
          .limit(1);

        let eligibleVote: EligibleVote | undefined = directVote;
        if (!eligibleVote) {
          [eligibleVote] = await transaction
            .select({ id: votes.id, issueVersion: votes.issueVersion, choice: issueChoices.code })
            .from(guestMemberLinks)
            .innerJoin(votes, eq(votes.subjectId, guestMemberLinks.guestSubjectId))
            .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
            .where(
              and(
                eq(guestMemberLinks.memberId, session.memberId),
                eq(votes.issueId, command.issueId),
                eq(votes.integrityState, "ACCEPTED"),
              ),
            )
            .orderBy(asc(votes.acceptedAt), asc(votes.id))
            .limit(1);
        }

        if (!eligibleVote) {
          throw new CommentError(
            "VOTE_REQUIRED",
            403,
            "An accepted Vote linked to this Member is required before writing a Comment.",
          );
        }

        const [issue] = await transaction
          .select({
            lifecycle: issues.lifecycle,
            visibility: issues.visibility,
            resultVisibility: issues.resultVisibility,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
          })
          .from(issues)
          .where(eq(issues.id, command.issueId))
          .limit(1)
          .for("update");

        if (!issue || !commentsAvailable(issue) || issue.lifecycle === "ARCHIVED") {
          throw new CommentError(
            "COMMENTS_UNAVAILABLE",
            403,
            "Comments are not available for writing on this Issue.",
          );
        }

        await transaction.insert(commentWriteAttempts).values({
          id: command.idempotencyKey,
          memberId: session.memberId,
          issueId: command.issueId,
          requestFingerprint,
        });

        const [comment] = await transaction
          .insert(comments)
          .values({
            issueId: command.issueId,
            issueVersion: eligibleVote.issueVersion,
            authorSubjectId: authorSubject.id,
            acceptedVoteId: eligibleVote.id,
            choice: eligibleVote.choice,
            authorDisplayName: session.displayName.slice(0, 40),
            body,
            textPolicyVersion: TEXT_POLICY_VERSION,
            publicationState: "PUBLISHED",
          })
          .returning();
        if (!comment) throw new Error("Comment insert did not return a row.");

        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "COMMENT",
          aggregateId: comment.id,
          eventType: "COMMENT_PUBLISHED",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: "COMMENT_PUBLISHED",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "COMMENT",
            aggregate_id: comment.id,
            data: {
              comment_id: comment.id,
              issue_id: comment.issueId,
              issue_version: comment.issueVersion,
              accepted_vote_id: comment.acceptedVoteId,
              author_subject_id: comment.authorSubjectId,
              choice: comment.choice,
              text_policy_version: TEXT_POLICY_VERSION,
            },
          },
        });

        const response: MemberCommentSubmissionResult = {
          httpStatus: 201,
          body: { comment: toPublicComment(comment) },
        };
        await transaction
          .update(commentWriteAttempts)
          .set({ completedAt: now, responseSnapshot: response })
          .where(eq(commentWriteAttempts.id, command.idempotencyKey));

        return response;
      });
    },
  };
}

export const createCommentReadService = createCommentService;
