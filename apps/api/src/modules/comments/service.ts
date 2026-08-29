import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  comments,
  commentRevisions,
  commentModerationDecisions,
  commentReactionAttempts,
  commentReactions,
  commentReportAttempts,
  commentReports,
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
  CommentReportCommand,
  CommentReportResult,
  CommentReactionCommand,
  CommentReactionResult,
  MemberCommentDeleteResult,
  MemberCommentSubmission,
  MemberCommentSubmissionResult,
  MemberCommentUpdateResult,
  PublicComment,
} from "./contracts.js";
import { sha256 } from "../content-revisions/service.js";
import { evaluateTextRules } from "../moderation/rule-engine.js";
import { decodeCommentCursor, encodeCommentCursor } from "./cursor.js";
import { CommentError } from "./errors.js";

const TEXT_POLICY_VERSION = "comment-text-v1";
const EVENT_SCHEMA_VERSION = 1;
const REPORT_POLICY_VERSION = "comment-report-v1";
const REPORT_DAILY_LIMIT = 20;
const COLLAPSE_SCORE = 10;
const COLLAPSE_REPORTERS = 5;
const HIDE_SCORE = 20;
const HIDE_REPORTERS = 10;

type EligibleVote = { id: string; issueVersion: number; choice: "A" | "B" };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeCommentBody(value: string) {
  const commonRules = evaluateTextRules({
    value,
    minimumLength: 2,
    maximumLength: 500,
    allowUrls: false,
    trustTier: "MEMBER",
  });
  const body = commonRules.normalized;
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
  if (commonRules.signals.some((signal) => signal.code === "TEXT_URL_PRESENT")) {
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

  return {
    body,
    requiresReview: commonRules.signals.some((signal) => signal.severity === "REVIEW"),
  };
}

function fingerprint(
  command: Pick<MemberCommentSubmission, "idempotencyKey" | "issueId" | "parentCommentId">,
  memberId: string,
  body: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        command.idempotencyKey,
        memberId,
        command.issueId,
        command.parentCommentId ?? null,
        body,
      ]),
    )
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

function toPublicComment(
  row: typeof comments.$inferSelect,
  reactions: PublicComment["reactions"] = {
    helpfulCount: 0,
    dislikeCount: 0,
    viewerReaction: null,
  },
  reports: PublicComment["reports"] = { viewerReported: false, canReport: false },
  permissions: PublicComment["permissions"] = { canEdit: false, canDelete: false },
  replies: PublicComment[] = [],
  authorAvatarUrl: string | null = null,
): PublicComment {
  return {
    id: row.id,
    choice: row.choice,
    author: { displayName: row.authorDisplayName, avatarUrl: authorAvatarUrl },
    body: row.body,
    visibility: row.visibility as PublicComment["visibility"],
    threadState: row.threadState,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    parentCommentId: row.parentCommentId,
    reactions,
    reports,
    permissions,
    replies,
  };
}

function normalizeReportDetail(command: Pick<CommentReportCommand, "reason" | "detail">) {
  const detail = command.detail?.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  if (command.reason === "OTHER") {
    if (!detail || Array.from(detail).length < 10) {
      throw new CommentError(
        "REPORT_DETAIL_REQUIRED",
        422,
        "OTHER reports require a detail of at least 10 characters.",
      );
    }
    return detail;
  }
  if (detail) {
    throw new CommentError(
      "REPORT_DETAIL_NOT_ALLOWED",
      422,
      "A report detail is only accepted for OTHER reports.",
    );
  }
  return undefined;
}

function reportFingerprint(
  command: CommentReportCommand,
  actorSubjectId: string,
  detail: string | undefined,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        command.idempotencyKey,
        actorSubjectId,
        command.commentId,
        command.reason,
        detail ?? null,
      ]),
    )
    .digest("hex");
}

function isStoredReportResponse(value: unknown): value is CommentReportResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CommentReportResult>;
  return (
    candidate.httpStatus === 201 &&
    candidate.body?.report?.accepted === true &&
    candidate.body.report.viewerReported === true &&
    typeof candidate.body.comment?.visibility === "string"
  );
}

function reactionFingerprint(command: CommentReactionCommand, actorSubjectId: string) {
  return createHash("sha256")
    .update(
      JSON.stringify([command.idempotencyKey, actorSubjectId, command.commentId, command.code]),
    )
    .digest("hex");
}

function isStoredReactionResponse(value: unknown): value is CommentReactionResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CommentReactionResult>;
  return (
    candidate.httpStatus === 200 &&
    typeof candidate.body?.reaction === "object" &&
    ["HELPFUL", "DISLIKE"].includes(candidate.body.reaction.code) &&
    typeof candidate.body.reaction.active === "boolean" &&
    typeof candidate.body.reaction.helpfulCount === "number" &&
    typeof candidate.body.reaction.dislikeCount === "number"
  );
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
      const view = query.view ?? "NEWEST";
      const sort = view === "HIGHLIGHT" ? "HELPFUL" : (query.sort ?? "NEWEST");
      if (view === "HIGHLIGHT" && query.cursor) {
        throw new CommentError(
          "INVALID_CURSOR",
          400,
          "Highlight Comments do not support cursor pagination.",
        );
      }
      const cursor = query.cursor ? decodeCommentCursor(query.cursor) : null;
      if (cursor && cursor.sort !== sort) {
        throw new CommentError(
          "INVALID_CURSOR",
          400,
          "The Comment cursor does not match the requested sort.",
        );
      }

      return database.transaction(async (transaction) => {
        let viewerSubjectId: string;
        let acceptedVote: { issueVersion: number } | undefined;
        let viewerCanMutate = false;

        if (query.sessionToken) {
          const [memberViewer] = await transaction
            .select({ memberId: members.id, subjectId: voterSubjects.id })
            .from(memberSessions)
            .innerJoin(members, eq(memberSessions.memberId, members.id))
            .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
            .where(
              and(
                eq(memberSessions.tokenHash, hashToken(query.sessionToken)),
                isNull(memberSessions.revokedAt),
                gt(memberSessions.expiresAt, new Date()),
                eq(members.status, "ACTIVE"),
              ),
            )
            .limit(1);
          if (!memberViewer) {
            throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
          }
          viewerSubjectId = memberViewer.subjectId;
          viewerCanMutate = true;
          [acceptedVote] = await transaction
            .select({ issueVersion: votes.issueVersion })
            .from(votes)
            .where(
              and(
                eq(votes.issueId, query.issueId),
                eq(votes.subjectId, viewerSubjectId),
                eq(votes.integrityState, "ACCEPTED"),
              ),
            )
            .limit(1);
          if (!acceptedVote) {
            [acceptedVote] = await transaction
              .select({ issueVersion: votes.issueVersion })
              .from(guestMemberLinks)
              .innerJoin(votes, eq(votes.subjectId, guestMemberLinks.guestSubjectId))
              .where(
                and(
                  eq(guestMemberLinks.memberId, memberViewer.memberId),
                  eq(votes.issueId, query.issueId),
                  eq(votes.integrityState, "ACCEPTED"),
                ),
              )
              .orderBy(asc(votes.acceptedAt), asc(votes.id))
              .limit(1);
          }
          if (!acceptedVote && query.anonymousSubjectId) {
            [acceptedVote] = await transaction
              .select({ issueVersion: votes.issueVersion })
              .from(voterSubjects)
              .innerJoin(votes, eq(votes.subjectId, voterSubjects.id))
              .leftJoin(guestMemberLinks, eq(guestMemberLinks.guestSubjectId, voterSubjects.id))
              .where(
                and(
                  eq(voterSubjects.kind, "GUEST"),
                  eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId),
                  eq(votes.issueId, query.issueId),
                  eq(votes.integrityState, "ACCEPTED"),
                  or(
                    isNull(guestMemberLinks.memberId),
                    eq(guestMemberLinks.memberId, memberViewer.memberId),
                  ),
                ),
              )
              .orderBy(asc(votes.acceptedAt), asc(votes.id))
              .limit(1);
          }
        } else {
          if (!query.anonymousSubjectId) {
            throw new CommentError(
              "VOTE_REQUIRED",
              403,
              "An accepted Vote is required before reading Comments.",
            );
          }
          const [guestViewer] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId))
            .limit(1);
          if (!guestViewer) {
            throw new CommentError(
              "VOTE_REQUIRED",
              403,
              "An accepted Vote is required before reading Comments.",
            );
          }
          const [guestLink] = await transaction
            .select({
              memberId: guestMemberLinks.memberId,
              memberSubjectId: guestMemberLinks.memberSubjectId,
            })
            .from(guestMemberLinks)
            .where(eq(guestMemberLinks.guestSubjectId, guestViewer.id))
            .limit(1);
          viewerSubjectId = guestLink?.memberSubjectId ?? guestViewer.id;
          [acceptedVote] = await transaction
            .select({ issueVersion: votes.issueVersion })
            .from(votes)
            .where(
              and(
                eq(votes.issueId, query.issueId),
                eq(votes.subjectId, guestViewer.id),
                eq(votes.integrityState, "ACCEPTED"),
              ),
            )
            .limit(1);
          if (!acceptedVote && guestLink) {
            [acceptedVote] = await transaction
              .select({ issueVersion: votes.issueVersion })
              .from(votes)
              .where(
                and(
                  eq(votes.issueId, query.issueId),
                  eq(votes.subjectId, guestLink.memberSubjectId),
                  eq(votes.integrityState, "ACCEPTED"),
                ),
              )
              .limit(1);
          }
          if (!acceptedVote && guestLink) {
            [acceptedVote] = await transaction
              .select({ issueVersion: votes.issueVersion })
              .from(guestMemberLinks)
              .innerJoin(votes, eq(votes.subjectId, guestMemberLinks.guestSubjectId))
              .where(
                and(
                  eq(guestMemberLinks.memberId, guestLink.memberId),
                  eq(votes.issueId, query.issueId),
                  eq(votes.integrityState, "ACCEPTED"),
                ),
              )
              .limit(1);
          }
        }

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

        const publicCommentFilters: SQL[] = [
          eq(comments.issueId, query.issueId),
          eq(comments.issueVersion, acceptedVote.issueVersion),
          eq(comments.publicationState, "PUBLISHED"),
          view === "HIGHLIGHT"
            ? eq(comments.visibility, "VISIBLE")
            : inArray(comments.visibility, ["VISIBLE", "DEPRIORITIZED", "COLLAPSED"]),
          eq(comments.integrityState, "NORMAL"),
          isNull(comments.deletedAt),
        ];
        const filters: SQL[] = [...publicCommentFilters, isNull(comments.parentCommentId)];

        const [commentTotal] = await transaction
          .select({ total: count() })
          .from(comments)
          .where(and(...publicCommentFilters));

        if (query.side !== "ALL") filters.push(eq(comments.choice, query.side));
        const helpfulCountOrder = sql<number>`(
          select count(*)::int
          from ${commentReactions}
          where ${commentReactions.commentId} = ${comments.id}
            and ${commentReactions.code} = 'HELPFUL'
            and ${commentReactions.active} = true
        )`;
        if (cursor && sort === "NEWEST") {
          filters.push(
            or(
              lt(comments.createdAt, cursor.createdAt),
              and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.commentId)),
            )!,
          );
        }
        if (cursor && sort === "HELPFUL") {
          const helpfulCount = cursor.helpfulCount ?? 0;
          filters.push(
            or(
              lt(helpfulCountOrder, helpfulCount),
              and(
                eq(helpfulCountOrder, helpfulCount),
                or(
                  lt(comments.createdAt, cursor.createdAt),
                  and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.commentId)),
                ),
              ),
            )!,
          );
        }
        const rows = await transaction
          .select()
          .from(comments)
          .where(and(...filters))
          .orderBy(
            ...(sort === "HELPFUL"
              ? [desc(helpfulCountOrder), desc(comments.createdAt), desc(comments.id)]
              : [desc(comments.createdAt), desc(comments.id)]),
          )
          .limit(view === "HIGHLIGHT" ? query.limit : query.limit + 1);

        const hasMore = view !== "HIGHLIGHT" && rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const lastItem = pageRows.at(-1);
        const rootCommentIds = pageRows.map((row) => row.id);
        const replyRows =
          rootCommentIds.length === 0
            ? []
            : await transaction
                .select()
                .from(comments)
                .where(
                  and(
                    inArray(comments.threadRootCommentId, rootCommentIds),
                    eq(comments.publicationState, "PUBLISHED"),
                    inArray(comments.visibility, ["VISIBLE", "DEPRIORITIZED", "COLLAPSED"]),
                    eq(comments.integrityState, "NORMAL"),
                    isNull(comments.deletedAt),
                  ),
                )
                .orderBy(asc(comments.createdAt), asc(comments.id));
        const commentIds = [...rootCommentIds, ...replyRows.map((row) => row.id)];
        const authorSubjectIds = Array.from(
          new Set([...pageRows, ...replyRows].map((row) => row.authorSubjectId)),
        );
        const authorProfiles =
          authorSubjectIds.length === 0
            ? []
            : await transaction
                .select({ subjectId: voterSubjects.id, avatarUrl: members.avatarUrl })
                .from(voterSubjects)
                .leftJoin(members, eq(voterSubjects.userId, members.id))
                .where(inArray(voterSubjects.id, authorSubjectIds));
        const reactionCounts =
          commentIds.length === 0
            ? []
            : await transaction
                .select({
                  commentId: commentReactions.commentId,
                  code: commentReactions.code,
                  total: count(),
                })
                .from(commentReactions)
                .where(
                  and(
                    inArray(commentReactions.commentId, commentIds),
                    eq(commentReactions.active, true),
                  ),
                )
                .groupBy(commentReactions.commentId, commentReactions.code);
        const viewerReactions =
          commentIds.length === 0
            ? []
            : await transaction
                .select({ commentId: commentReactions.commentId, code: commentReactions.code })
                .from(commentReactions)
                .where(
                  and(
                    inArray(commentReactions.commentId, commentIds),
                    eq(commentReactions.subjectId, viewerSubjectId),
                    eq(commentReactions.active, true),
                  ),
                );
        const viewerReports =
          commentIds.length === 0
            ? []
            : await transaction
                .select({ commentId: commentReports.commentId })
                .from(commentReports)
                .where(
                  and(
                    inArray(commentReports.commentId, commentIds),
                    eq(commentReports.subjectId, viewerSubjectId),
                    eq(commentReports.counted, true),
                  ),
                );
        const countByComment = new Map(
          reactionCounts.map((reaction) => [
            `${reaction.commentId}:${reaction.code}`,
            reaction.total,
          ]),
        );
        const viewerReactionByComment = new Map(
          viewerReactions.map((reaction) => [reaction.commentId, reaction.code]),
        );
        const reportedCommentIds = new Set(viewerReports.map((report) => report.commentId));
        const avatarBySubject = new Map(
          authorProfiles.map((profile) => [profile.subjectId, profile.avatarUrl]),
        );

        const materialize = (row: typeof comments.$inferSelect, replies: PublicComment[] = []) => {
          const viewerReported = reportedCommentIds.has(row.id);
          return toPublicComment(
            row,
            {
              helpfulCount: countByComment.get(`${row.id}:HELPFUL`) ?? 0,
              dislikeCount: countByComment.get(`${row.id}:DISLIKE`) ?? 0,
              viewerReaction: viewerReactionByComment.get(row.id) ?? null,
            },
            {
              viewerReported,
              canReport: row.authorSubjectId !== viewerSubjectId && !viewerReported,
            },
            {
              canEdit: viewerCanMutate && row.authorSubjectId === viewerSubjectId,
              canDelete: viewerCanMutate && row.authorSubjectId === viewerSubjectId,
            },
            replies,
            avatarBySubject.get(row.authorSubjectId) ?? null,
          );
        };
        const repliesByParent = new Map<string, Array<typeof comments.$inferSelect>>();
        for (const reply of replyRows) {
          if (!reply.parentCommentId) continue;
          const siblings = repliesByParent.get(reply.parentCommentId) ?? [];
          siblings.push(reply);
          repliesByParent.set(reply.parentCommentId, siblings);
        }

        const materializeTree = (row: typeof comments.$inferSelect): PublicComment =>
          materialize(
            row,
            (repliesByParent.get(row.id) ?? []).map((reply) => materializeTree(reply)),
          );

        return {
          items: pageRows.map((row) => materializeTree(row)),
          totalCount: commentTotal?.total ?? 0,
          nextCursor:
            view !== "HIGHLIGHT" && hasMore && lastItem
              ? encodeCommentCursor({
                  sort,
                  createdAt: lastItem.createdAt,
                  commentId: lastItem.id,
                  helpfulCount:
                    sort === "HELPFUL"
                      ? (countByComment.get(`${lastItem.id}:HELPFUL`) ?? 0)
                      : undefined,
                })
              : null,
        };
      });
    },

    async submitMemberComment(command) {
      const { body, requiresReview } = normalizeCommentBody(command.body);
      const now = new Date();

      return database.transaction(async (transaction) => {
        const [session] = await transaction
          .select({
            memberId: members.id,
            displayName: members.displayName,
            avatarUrl: members.avatarUrl,
          })
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

        const [authorSubject] = await transaction
          .select({ id: voterSubjects.id })
          .from(voterSubjects)
          .where(and(eq(voterSubjects.kind, "MEMBER"), eq(voterSubjects.userId, session.memberId)))
          .limit(1);
        if (!authorSubject) throw new Error("Member voter subject is missing.");

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

        if (!eligibleVote && command.anonymousSubjectId) {
          [eligibleVote] = await transaction
            .select({ id: votes.id, issueVersion: votes.issueVersion, choice: issueChoices.code })
            .from(voterSubjects)
            .innerJoin(votes, eq(votes.subjectId, voterSubjects.id))
            .innerJoin(issueChoices, eq(issueChoices.id, votes.choiceId))
            .leftJoin(guestMemberLinks, eq(guestMemberLinks.guestSubjectId, voterSubjects.id))
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
                eq(votes.issueId, command.issueId),
                eq(votes.integrityState, "ACCEPTED"),
                or(
                  isNull(guestMemberLinks.memberId),
                  eq(guestMemberLinks.memberId, session.memberId),
                ),
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

        let parentComment: { id: string; threadRootCommentId: string | null } | undefined;
        if (command.parentCommentId) {
          [parentComment] = await transaction
            .select({ id: comments.id, threadRootCommentId: comments.threadRootCommentId })
            .from(comments)
            .where(
              and(
                eq(comments.id, command.parentCommentId),
                eq(comments.issueId, command.issueId),
                eq(comments.issueVersion, eligibleVote.issueVersion),
                eq(comments.publicationState, "PUBLISHED"),
                inArray(comments.visibility, ["VISIBLE", "DEPRIORITIZED", "COLLAPSED"]),
                eq(comments.integrityState, "NORMAL"),
                eq(comments.threadState, "OPEN"),
                isNull(comments.deletedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!parentComment) {
            throw new CommentError(
              "REPLY_PARENT_UNAVAILABLE",
              409,
              "Replies are only available on an open published Comment.",
            );
          }
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
            parentCommentId: parentComment?.id,
            threadRootCommentId: parentComment
              ? (parentComment.threadRootCommentId ?? parentComment.id)
              : undefined,
            authorDisplayName: session.displayName.slice(0, 40),
            body,
            textPolicyVersion: TEXT_POLICY_VERSION,
            publicationState: requiresReview ? "PENDING_HUMAN_REVIEW" : "PUBLISHED",
          })
          .returning();
        if (!comment) throw new Error("Comment insert did not return a row.");

        await transaction.insert(commentRevisions).values({
          commentId: comment.id,
          revision: 1,
          operation: "CREATED",
          body: comment.body,
          textPolicyVersion: comment.textPolicyVersion,
          inputHash: sha256(comment.body),
          sourceCommentVersion: comment.version,
          publicationState: comment.publicationState,
          visibility: comment.visibility,
          integrityState: comment.integrityState,
          createdAt: now,
        });

        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "COMMENT",
          aggregateId: comment.id,
          eventType: requiresReview ? "COMMENT_REVIEW_REQUESTED" : "COMMENT_PUBLISHED",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: requiresReview ? "COMMENT_REVIEW_REQUESTED" : "COMMENT_PUBLISHED",
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
              parent_comment_id: comment.parentCommentId,
              text_policy_version: TEXT_POLICY_VERSION,
            },
          },
        });

        const response: MemberCommentSubmissionResult = {
          httpStatus: 201,
          body: {
            comment: toPublicComment(
              comment,
              undefined,
              undefined,
              { canEdit: true, canDelete: true },
              [],
              session.avatarUrl,
            ),
          },
        };
        await transaction
          .update(commentWriteAttempts)
          .set({ completedAt: now, responseSnapshot: response })
          .where(eq(commentWriteAttempts.id, command.idempotencyKey));

        return response;
      });
    },

    async updateMemberComment(command) {
      const { body, requiresReview } = normalizeCommentBody(command.body);
      const now = new Date();

      return database.transaction(async (transaction): Promise<MemberCommentUpdateResult> => {
        const [actor] = await transaction
          .select({ subjectId: voterSubjects.id })
          .from(memberSessions)
          .innerJoin(members, eq(memberSessions.memberId, members.id))
          .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
          .where(
            and(
              eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
              isNull(memberSessions.revokedAt),
              gt(memberSessions.expiresAt, now),
              eq(members.status, "ACTIVE"),
              eq(voterSubjects.kind, "MEMBER"),
            ),
          )
          .limit(1);
        if (!actor) {
          throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }

        const [target] = await transaction
          .select()
          .from(comments)
          .where(eq(comments.id, command.commentId))
          .limit(1)
          .for("update");
        if (!target || target.deletedAt) {
          throw new CommentError("COMMENT_NOT_FOUND", 404, "The Comment does not exist.");
        }
        if (target.authorSubjectId !== actor.subjectId) {
          throw new CommentError(
            "COMMENT_AUTHOR_REQUIRED",
            403,
            "Only the Comment author can edit this Comment.",
          );
        }
        if (
          target.publicationState !== "PUBLISHED" ||
          target.integrityState !== "NORMAL" ||
          !["VISIBLE", "DEPRIORITIZED", "COLLAPSED"].includes(target.visibility)
        ) {
          throw new CommentError(
            "COMMENT_MUTATION_UNAVAILABLE",
            409,
            "This Comment cannot be edited in its current state.",
          );
        }

        const [updated] = await transaction
          .update(comments)
          .set({
            body,
            textPolicyVersion: TEXT_POLICY_VERSION,
            publicationState: requiresReview ? "PENDING_HUMAN_REVIEW" : "PUBLISHED",
            editedAt: now,
            bodyRevision: sql`${comments.bodyRevision} + 1`,
            version: sql`${comments.version} + 1`,
            updatedAt: now,
          })
          .where(eq(comments.id, command.commentId))
          .returning({
            id: comments.id,
            body: comments.body,
            bodyRevision: comments.bodyRevision,
            version: comments.version,
            publicationState: comments.publicationState,
            visibility: comments.visibility,
            integrityState: comments.integrityState,
            editedAt: comments.editedAt,
          });
        if (!updated?.editedAt) throw new Error("Comment update did not return a row.");

        await transaction.insert(commentRevisions).values({
          commentId: updated.id,
          revision: updated.bodyRevision,
          operation: "EDITED",
          body: updated.body,
          textPolicyVersion: TEXT_POLICY_VERSION,
          inputHash: sha256(updated.body),
          sourceCommentVersion: updated.version,
          publicationState: updated.publicationState,
          visibility: updated.visibility,
          integrityState: updated.integrityState,
          createdAt: now,
        });

        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "COMMENT",
          aggregateId: updated.id,
          eventType: requiresReview ? "COMMENT_REVIEW_REQUESTED" : "COMMENT_EDITED",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: requiresReview ? "COMMENT_REVIEW_REQUESTED" : "COMMENT_EDITED",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "COMMENT",
            aggregate_id: updated.id,
            data: { comment_id: updated.id, text_policy_version: TEXT_POLICY_VERSION },
          },
        });

        return {
          httpStatus: 200,
          body: {
            comment: {
              id: updated.id,
              body: updated.body,
              editedAt: updated.editedAt.toISOString(),
            },
          },
        };
      });
    },

    async deleteMemberComment(command) {
      const now = new Date();

      return database.transaction(async (transaction): Promise<MemberCommentDeleteResult> => {
        const [actor] = await transaction
          .select({ subjectId: voterSubjects.id })
          .from(memberSessions)
          .innerJoin(members, eq(memberSessions.memberId, members.id))
          .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
          .where(
            and(
              eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
              isNull(memberSessions.revokedAt),
              gt(memberSessions.expiresAt, now),
              eq(members.status, "ACTIVE"),
              eq(voterSubjects.kind, "MEMBER"),
            ),
          )
          .limit(1);
        if (!actor) {
          throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }

        const [target] = await transaction
          .select({
            authorSubjectId: comments.authorSubjectId,
            bodyRevision: comments.bodyRevision,
            version: comments.version,
            publicationState: comments.publicationState,
            integrityState: comments.integrityState,
            deletedAt: comments.deletedAt,
          })
          .from(comments)
          .where(eq(comments.id, command.commentId))
          .limit(1)
          .for("update");
        if (!target || target.deletedAt) {
          throw new CommentError("COMMENT_NOT_FOUND", 404, "The Comment does not exist.");
        }
        if (target.authorSubjectId !== actor.subjectId) {
          throw new CommentError(
            "COMMENT_AUTHOR_REQUIRED",
            403,
            "Only the Comment author can delete this Comment.",
          );
        }

        const removedBody = "[작성자가 삭제한 댓글]";
        const [removed] = await transaction
          .update(comments)
          .set({
            body: removedBody,
            visibility: "REMOVED_BY_AUTHOR",
            deletedAt: now,
            bodyRevision: sql`${comments.bodyRevision} + 1`,
            version: sql`${comments.version} + 1`,
            updatedAt: now,
          })
          .where(eq(comments.id, command.commentId))
          .returning({
            bodyRevision: comments.bodyRevision,
            version: comments.version,
          });
        if (!removed) throw new Error("Comment delete did not return a row.");

        await transaction.insert(commentRevisions).values({
          commentId: command.commentId,
          revision: removed.bodyRevision,
          operation: "AUTHOR_REMOVED",
          body: removedBody,
          textPolicyVersion: TEXT_POLICY_VERSION,
          inputHash: sha256(removedBody),
          sourceCommentVersion: removed.version,
          publicationState: target.publicationState,
          visibility: "REMOVED_BY_AUTHOR",
          integrityState: target.integrityState,
          createdAt: now,
        });

        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "COMMENT",
          aggregateId: command.commentId,
          eventType: "COMMENT_REMOVED_BY_AUTHOR",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: "COMMENT_REMOVED_BY_AUTHOR",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "COMMENT",
            aggregate_id: command.commentId,
            data: { comment_id: command.commentId },
          },
        });

        return {
          httpStatus: 200,
          body: { comment: { id: command.commentId, deleted: true } },
        };
      });
    },

    async toggleCommentReaction(command) {
      const now = new Date();

      return database.transaction(async (transaction) => {
        let actorSubjectId: string;
        let voteSubjectId: string;
        let originSubjectId: string;
        let actorMemberId: string | undefined;

        if (command.sessionToken) {
          const [memberActor] = await transaction
            .select({ memberId: members.id, subjectId: voterSubjects.id })
            .from(memberSessions)
            .innerJoin(members, eq(memberSessions.memberId, members.id))
            .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
            .where(
              and(
                eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
                isNull(memberSessions.revokedAt),
                gt(memberSessions.expiresAt, now),
                eq(members.status, "ACTIVE"),
              ),
            )
            .limit(1);
          if (!memberActor) {
            throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
          }
          actorSubjectId = memberActor.subjectId;
          voteSubjectId = memberActor.subjectId;
          originSubjectId = memberActor.subjectId;
          actorMemberId = memberActor.memberId;
        } else {
          if (!command.anonymousSubjectId) {
            throw new CommentError(
              "REACTION_SUBJECT_REQUIRED",
              401,
              "A Guest subject or Member session is required.",
            );
          }
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${command.anonymousSubjectId}, 0))`,
          );
          const [guestActor] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
              ),
            )
            .limit(1);
          if (!guestActor) {
            throw new CommentError(
              "REACTION_SUBJECT_REQUIRED",
              401,
              "The Guest subject is invalid.",
            );
          }
          const [guestLink] = await transaction
            .select({
              memberId: guestMemberLinks.memberId,
              memberSubjectId: guestMemberLinks.memberSubjectId,
            })
            .from(guestMemberLinks)
            .where(eq(guestMemberLinks.guestSubjectId, guestActor.id))
            .limit(1);
          actorSubjectId = guestLink?.memberSubjectId ?? guestActor.id;
          voteSubjectId = guestLink?.memberSubjectId ?? guestActor.id;
          originSubjectId = guestActor.id;
          actorMemberId = guestLink?.memberId;
        }

        const requestFingerprint = reactionFingerprint(command, actorSubjectId);
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`,
        );
        const [existingAttempt] = await transaction
          .select({
            actorSubjectId: commentReactionAttempts.actorSubjectId,
            requestFingerprint: commentReactionAttempts.requestFingerprint,
            responseSnapshot: commentReactionAttempts.responseSnapshot,
          })
          .from(commentReactionAttempts)
          .where(eq(commentReactionAttempts.id, command.idempotencyKey))
          .limit(1);
        if (existingAttempt) {
          if (
            existingAttempt.actorSubjectId !== actorSubjectId ||
            existingAttempt.requestFingerprint !== requestFingerprint
          ) {
            throw new CommentError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "The Idempotency-Key was already used for a different reaction request.",
            );
          }
          if (!isStoredReactionResponse(existingAttempt.responseSnapshot)) {
            throw new CommentError(
              "IDEMPOTENCY_INCOMPLETE",
              409,
              "The original reaction request has not reached a reusable result.",
            );
          }
          return existingAttempt.responseSnapshot;
        }

        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${command.commentId}:${actorSubjectId}:REACTION`}, 0))`,
        );

        const [target] = await transaction
          .select({
            commentId: comments.id,
            issueId: comments.issueId,
            issueVersion: comments.issueVersion,
            parentCommentId: comments.parentCommentId,
            publicationState: comments.publicationState,
            commentVisibility: comments.visibility,
            commentIntegrityState: comments.integrityState,
            deletedAt: comments.deletedAt,
            lifecycle: issues.lifecycle,
            issueVisibility: issues.visibility,
            resultVisibility: issues.resultVisibility,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
          })
          .from(comments)
          .innerJoin(issues, eq(issues.id, comments.issueId))
          .where(eq(comments.id, command.commentId))
          .limit(1)
          .for("update");

        const publicTarget =
          target &&
          commentsAvailable({
            lifecycle: target.lifecycle,
            visibility: target.issueVisibility,
            resultVisibility: target.resultVisibility,
            riskLevel: target.riskLevel,
            isPolitical: target.isPolitical,
          }) &&
          target.publicationState === "PUBLISHED" &&
          ["VISIBLE", "DEPRIORITIZED"].includes(target.commentVisibility) &&
          target.commentIntegrityState === "NORMAL" &&
          target.deletedAt === null;
        if (!target || !publicTarget) {
          throw new CommentError(
            "REACTION_UNAVAILABLE",
            403,
            "Reactions are not available for this Comment.",
          );
        }

        let [eligibleVote] = await transaction
          .select({ id: votes.id })
          .from(votes)
          .where(
            and(
              eq(votes.issueId, target.issueId),
              eq(votes.issueVersion, target.issueVersion),
              eq(votes.subjectId, voteSubjectId),
              eq(votes.integrityState, "ACCEPTED"),
            ),
          )
          .limit(1);
        if (!eligibleVote && actorMemberId) {
          [eligibleVote] = await transaction
            .select({ id: votes.id })
            .from(guestMemberLinks)
            .innerJoin(votes, eq(votes.subjectId, guestMemberLinks.guestSubjectId))
            .where(
              and(
                eq(guestMemberLinks.memberId, actorMemberId),
                eq(votes.issueId, target.issueId),
                eq(votes.issueVersion, target.issueVersion),
                eq(votes.integrityState, "ACCEPTED"),
              ),
            )
            .limit(1);
        }
        if (!eligibleVote && actorMemberId && command.anonymousSubjectId) {
          [eligibleVote] = await transaction
            .select({ id: votes.id })
            .from(voterSubjects)
            .innerJoin(votes, eq(votes.subjectId, voterSubjects.id))
            .leftJoin(guestMemberLinks, eq(guestMemberLinks.guestSubjectId, voterSubjects.id))
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
                eq(votes.issueId, target.issueId),
                eq(votes.issueVersion, target.issueVersion),
                eq(votes.integrityState, "ACCEPTED"),
                or(isNull(guestMemberLinks.memberId), eq(guestMemberLinks.memberId, actorMemberId)),
              ),
            )
            .limit(1);
        }
        if (!eligibleVote) {
          throw new CommentError(
            "VOTE_REQUIRED",
            403,
            "An accepted Vote on the Comment Issue is required.",
          );
        }

        await transaction.insert(commentReactionAttempts).values({
          id: command.idempotencyKey,
          commentId: command.commentId,
          actorSubjectId,
          code: command.code,
          requestFingerprint,
        });

        const [existingReaction] = await transaction
          .select()
          .from(commentReactions)
          .where(
            and(
              eq(commentReactions.commentId, command.commentId),
              eq(commentReactions.subjectId, actorSubjectId),
              eq(commentReactions.code, command.code),
            ),
          )
          .limit(1);
        const active = !existingReaction?.active;
        if (active) {
          await transaction
            .update(commentReactions)
            .set({ active: false, deactivatedAt: now, updatedAt: now })
            .where(
              and(
                eq(commentReactions.commentId, command.commentId),
                eq(commentReactions.subjectId, actorSubjectId),
                eq(commentReactions.active, true),
              ),
            );
        }
        if (existingReaction) {
          await transaction
            .update(commentReactions)
            .set({
              active,
              activatedAt: active ? now : existingReaction.activatedAt,
              deactivatedAt: active ? null : now,
              mergedIntoReactionId: null,
              updatedAt: now,
            })
            .where(eq(commentReactions.id, existingReaction.id));
        } else {
          await transaction.insert(commentReactions).values({
            commentId: command.commentId,
            subjectId: actorSubjectId,
            originSubjectId,
            code: command.code,
            active: true,
            activatedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }

        const aggregates = await transaction
          .select({ code: commentReactions.code, total: count() })
          .from(commentReactions)
          .where(
            and(
              eq(commentReactions.commentId, command.commentId),
              eq(commentReactions.active, true),
            ),
          )
          .groupBy(commentReactions.code);
        const helpfulCount =
          aggregates.find((aggregate) => aggregate.code === "HELPFUL")?.total ?? 0;
        const dislikeCount =
          aggregates.find((aggregate) => aggregate.code === "DISLIKE")?.total ?? 0;

        const eventId = randomUUID();
        const eventType = active ? "COMMENT_REACTION_ACTIVATED" : "COMMENT_REACTION_DEACTIVATED";
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "COMMENT",
          aggregateId: command.commentId,
          eventType,
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: eventType,
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "COMMENT",
            aggregate_id: command.commentId,
            data: {
              comment_id: command.commentId,
              actor_subject_id: actorSubjectId,
              reaction_code: command.code,
              active,
              helpful_count: helpfulCount,
              dislike_count: dislikeCount,
            },
          },
        });

        const response: CommentReactionResult = {
          httpStatus: 200,
          body: { reaction: { code: command.code, active, helpfulCount, dislikeCount } },
        };
        await transaction
          .update(commentReactionAttempts)
          .set({ completedAt: now, responseSnapshot: response })
          .where(eq(commentReactionAttempts.id, command.idempotencyKey));
        return response;
      });
    },

    async reportComment(command) {
      const detail = normalizeReportDetail(command);
      const now = new Date();

      return database.transaction(async (transaction) => {
        let actorSubjectId: string;
        let originSubjectId: string;
        let actorMemberId: string | undefined;
        let actorKind: "GUEST" | "MEMBER" | "VERIFIED_MEMBER";

        if (command.sessionToken) {
          const [memberActor] = await transaction
            .select({
              memberId: members.id,
              subjectId: voterSubjects.id,
              kind: voterSubjects.kind,
            })
            .from(memberSessions)
            .innerJoin(members, eq(memberSessions.memberId, members.id))
            .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
            .where(
              and(
                eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
                isNull(memberSessions.revokedAt),
                gt(memberSessions.expiresAt, now),
                eq(members.status, "ACTIVE"),
              ),
            )
            .limit(1);
          if (!memberActor || memberActor.kind === "DELETED_MEMBER") {
            throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
          }
          actorSubjectId = memberActor.subjectId;
          originSubjectId = memberActor.subjectId;
          actorMemberId = memberActor.memberId;
          actorKind = memberActor.kind;
        } else {
          if (!command.anonymousSubjectId) {
            throw new CommentError(
              "REPORT_SUBJECT_REQUIRED",
              401,
              "A Guest subject or Member session is required.",
            );
          }
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${command.anonymousSubjectId}, 0))`,
          );
          const [guestActor] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
              ),
            )
            .limit(1);
          if (!guestActor) {
            throw new CommentError("REPORT_SUBJECT_REQUIRED", 401, "The Guest subject is invalid.");
          }
          const [guestLink] = await transaction
            .select({
              memberId: guestMemberLinks.memberId,
              memberSubjectId: guestMemberLinks.memberSubjectId,
              memberKind: voterSubjects.kind,
            })
            .from(guestMemberLinks)
            .innerJoin(voterSubjects, eq(voterSubjects.id, guestMemberLinks.memberSubjectId))
            .where(eq(guestMemberLinks.guestSubjectId, guestActor.id))
            .limit(1);
          actorSubjectId = guestLink?.memberSubjectId ?? guestActor.id;
          originSubjectId = guestActor.id;
          actorMemberId = guestLink?.memberId;
          actorKind =
            guestLink?.memberKind && guestLink.memberKind !== "DELETED_MEMBER"
              ? guestLink.memberKind
              : "GUEST";
        }

        const requestFingerprint = reportFingerprint(command, actorSubjectId, detail);
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`,
        );
        const [existingAttempt] = await transaction
          .select({
            actorSubjectId: commentReportAttempts.actorSubjectId,
            requestFingerprint: commentReportAttempts.requestFingerprint,
            responseSnapshot: commentReportAttempts.responseSnapshot,
          })
          .from(commentReportAttempts)
          .where(eq(commentReportAttempts.id, command.idempotencyKey))
          .limit(1);
        if (existingAttempt) {
          if (
            existingAttempt.actorSubjectId !== actorSubjectId ||
            existingAttempt.requestFingerprint !== requestFingerprint
          ) {
            throw new CommentError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "The Idempotency-Key was already used for a different report request.",
            );
          }
          if (!isStoredReportResponse(existingAttempt.responseSnapshot)) {
            throw new CommentError(
              "IDEMPOTENCY_INCOMPLETE",
              409,
              "The original report request has not reached a reusable result.",
            );
          }
          return existingAttempt.responseSnapshot;
        }

        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${command.commentId}:${actorSubjectId}:REPORT`}, 0))`,
        );
        const [target] = await transaction
          .select({
            commentId: comments.id,
            issueId: comments.issueId,
            issueVersion: comments.issueVersion,
            authorSubjectId: comments.authorSubjectId,
            publicationState: comments.publicationState,
            commentVisibility: comments.visibility,
            commentIntegrityState: comments.integrityState,
            reportScoreBaseline: comments.reportScoreBaseline,
            reporterCountBaseline: comments.reporterCountBaseline,
            deletedAt: comments.deletedAt,
            lifecycle: issues.lifecycle,
            issueVisibility: issues.visibility,
            resultVisibility: issues.resultVisibility,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
          })
          .from(comments)
          .innerJoin(issues, eq(issues.id, comments.issueId))
          .where(eq(comments.id, command.commentId))
          .limit(1)
          .for("update");

        const reportableTarget =
          target &&
          commentsAvailable({
            lifecycle: target.lifecycle,
            visibility: target.issueVisibility,
            resultVisibility: target.resultVisibility,
            riskLevel: target.riskLevel,
            isPolitical: target.isPolitical,
          }) &&
          target.publicationState === "PUBLISHED" &&
          ["VISIBLE", "DEPRIORITIZED", "COLLAPSED"].includes(target.commentVisibility) &&
          target.commentIntegrityState === "NORMAL" &&
          target.deletedAt === null;
        if (!target || !reportableTarget) {
          throw new CommentError(
            "REPORT_UNAVAILABLE",
            403,
            "Reports are not available for this Comment.",
          );
        }
        if (target.authorSubjectId === actorSubjectId) {
          throw new CommentError(
            "REPORT_OWN_COMMENT",
            403,
            "Authors cannot report their own Comment.",
          );
        }

        let [eligibleVote] = await transaction
          .select({ id: votes.id })
          .from(votes)
          .where(
            and(
              eq(votes.issueId, target.issueId),
              eq(votes.issueVersion, target.issueVersion),
              eq(votes.subjectId, actorSubjectId),
              eq(votes.integrityState, "ACCEPTED"),
            ),
          )
          .limit(1);
        if (!eligibleVote && actorMemberId) {
          [eligibleVote] = await transaction
            .select({ id: votes.id })
            .from(guestMemberLinks)
            .innerJoin(votes, eq(votes.subjectId, guestMemberLinks.guestSubjectId))
            .where(
              and(
                eq(guestMemberLinks.memberId, actorMemberId),
                eq(votes.issueId, target.issueId),
                eq(votes.issueVersion, target.issueVersion),
                eq(votes.integrityState, "ACCEPTED"),
              ),
            )
            .limit(1);
        }
        if (!eligibleVote) {
          throw new CommentError(
            "VOTE_REQUIRED",
            403,
            "An accepted Vote on the Comment Issue is required.",
          );
        }

        const [existingReport] = await transaction
          .select({ id: commentReports.id })
          .from(commentReports)
          .where(
            and(
              eq(commentReports.commentId, command.commentId),
              eq(commentReports.subjectId, actorSubjectId),
              eq(commentReports.counted, true),
            ),
          )
          .limit(1);
        if (existingReport) {
          throw new CommentError(
            "REPORT_ALREADY_EXISTS",
            409,
            "This subject already reported the Comment.",
          );
        }

        const [daily] = await transaction
          .select({ total: count() })
          .from(commentReports)
          .where(
            and(
              eq(commentReports.subjectId, actorSubjectId),
              eq(commentReports.counted, true),
              gt(commentReports.createdAt, new Date(now.getTime() - 86_400_000)),
            ),
          );
        if ((daily?.total ?? 0) >= REPORT_DAILY_LIMIT) {
          throw new CommentError(
            "REPORT_RATE_LIMITED",
            429,
            "The daily Comment report limit has been reached.",
          );
        }

        await transaction.insert(commentReportAttempts).values({
          id: command.idempotencyKey,
          commentId: command.commentId,
          actorSubjectId,
          requestFingerprint,
        });
        const weight = actorKind === "GUEST" ? 1 : 2;
        const [report] = await transaction
          .insert(commentReports)
          .values({
            commentId: command.commentId,
            subjectId: actorSubjectId,
            originSubjectId,
            reason: command.reason,
            detail,
            weight,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: commentReports.id });
        if (!report) throw new Error("Comment report insert did not return a row.");

        const [aggregate] = await transaction
          .select({ score: sum(commentReports.weight), reporters: count() })
          .from(commentReports)
          .where(
            and(eq(commentReports.commentId, command.commentId), eq(commentReports.counted, true)),
          );
        const reportScore = Number(aggregate?.score ?? 0);
        const reporterCount = aggregate?.reporters ?? 0;
        const effectiveScore = reportScore - target.reportScoreBaseline;
        const effectiveReporters = reporterCount - target.reporterCountBaseline;

        let nextPublicationState = target.publicationState;
        let nextVisibility = target.commentVisibility;
        let nextIntegrityState = target.commentIntegrityState;
        let autoAction: "COLLAPSE" | "HIDE" | null = null;
        if (effectiveScore >= HIDE_SCORE && effectiveReporters >= HIDE_REPORTERS) {
          nextPublicationState = "PENDING_HUMAN_REVIEW";
          nextVisibility = "HIDDEN";
          nextIntegrityState = "REVIEW";
          autoAction = "HIDE";
        } else if (
          effectiveScore >= COLLAPSE_SCORE &&
          effectiveReporters >= COLLAPSE_REPORTERS &&
          target.commentVisibility !== "COLLAPSED"
        ) {
          nextVisibility = "COLLAPSED";
          autoAction = "COLLAPSE";
        }

        if (autoAction) {
          await transaction
            .update(comments)
            .set({
              publicationState: nextPublicationState,
              visibility: nextVisibility,
              integrityState: nextIntegrityState,
              version: sql`${comments.version} + 1`,
              updatedAt: now,
            })
            .where(eq(comments.id, command.commentId));
          await transaction.insert(commentModerationDecisions).values({
            commentId: command.commentId,
            revision: sql`(select coalesce(max(revision), 0) + 1 from comment_moderation_decisions where comment_id = ${command.commentId})`,
            action: autoAction,
            source: "SYSTEM_AUTOMATION",
            reasonCode: autoAction === "HIDE" ? "REPORT_SCORE_20" : "REPORT_SCORE_10",
            fromPublicationState: target.publicationState,
            toPublicationState: nextPublicationState,
            fromVisibility: target.commentVisibility,
            toVisibility: nextVisibility,
            fromIntegrityState: target.commentIntegrityState,
            toIntegrityState: nextIntegrityState,
            evidence: {
              policy_version: REPORT_POLICY_VERSION,
              report_score: reportScore,
              reporter_count: reporterCount,
              effective_report_score: effectiveScore,
              effective_reporter_count: effectiveReporters,
            },
            decidedAt: now,
          });
        }

        const reportEventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: reportEventId,
          aggregateType: "COMMENT",
          aggregateId: command.commentId,
          eventType: "COMMENT_REPORTED",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: reportEventId,
            event_type: "COMMENT_REPORTED",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "COMMENT",
            aggregate_id: command.commentId,
            data: {
              report_id: report.id,
              actor_subject_id: actorSubjectId,
              reason: command.reason,
              weight,
              policy_version: REPORT_POLICY_VERSION,
            },
          },
        });
        if (autoAction) {
          const moderationEventId = randomUUID();
          const eventType =
            autoAction === "HIDE" ? "COMMENT_AUTO_HIDDEN" : "COMMENT_AUTO_COLLAPSED";
          await transaction.insert(outboxEvents).values({
            id: moderationEventId,
            aggregateType: "COMMENT",
            aggregateId: command.commentId,
            eventType,
            schemaVersion: EVENT_SCHEMA_VERSION,
            occurredAt: now,
            payload: {
              event_id: moderationEventId,
              event_type: eventType,
              schema_version: EVENT_SCHEMA_VERSION,
              occurred_at: now.toISOString(),
              aggregate_type: "COMMENT",
              aggregate_id: command.commentId,
              data: {
                report_score: reportScore,
                reporter_count: reporterCount,
                visibility: nextVisibility,
              },
            },
          });
        }

        const response: CommentReportResult = {
          httpStatus: 201,
          body: {
            report: { accepted: true, viewerReported: true },
            comment: {
              visibility: nextVisibility as CommentReportResult["body"]["comment"]["visibility"],
            },
          },
        };
        await transaction
          .update(commentReportAttempts)
          .set({ completedAt: now, responseSnapshot: response })
          .where(eq(commentReportAttempts.id, command.idempotencyKey));
        return response;
      });
    },

    async listModerationCases(limit) {
      return database.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(comments)
          .where(
            or(
              eq(comments.visibility, "COLLAPSED"),
              eq(comments.publicationState, "PENDING_HUMAN_REVIEW"),
            ),
          )
          .orderBy(desc(comments.updatedAt), desc(comments.id))
          .limit(limit);
        const commentIds = rows.map((row) => row.id);
        const aggregates =
          commentIds.length === 0
            ? []
            : await transaction
                .select({
                  commentId: commentReports.commentId,
                  score: sum(commentReports.weight),
                  reporters: count(),
                })
                .from(commentReports)
                .where(
                  and(
                    inArray(commentReports.commentId, commentIds),
                    eq(commentReports.counted, true),
                  ),
                )
                .groupBy(commentReports.commentId);
        const aggregateByComment = new Map(
          aggregates.map((aggregate) => [aggregate.commentId, aggregate]),
        );
        return {
          items: rows.map((row) => {
            const aggregate = aggregateByComment.get(row.id);
            const reportScore = Number(aggregate?.score ?? 0);
            const reporterCount = aggregate?.reporters ?? 0;
            return {
              commentId: row.id,
              issueId: row.issueId,
              authorDisplayName: row.authorDisplayName,
              body: row.body,
              publicationState: row.publicationState,
              visibility: row.visibility,
              integrityState: row.integrityState,
              reportScore,
              reporterCount,
              effectiveReportScore: reportScore - row.reportScoreBaseline,
              effectiveReporterCount: reporterCount - row.reporterCountBaseline,
              updatedAt: row.updatedAt.toISOString(),
            };
          }),
        };
      });
    },

    async decideModeration(command) {
      const now = new Date();
      return database.transaction(async (transaction) => {
        const [target] = await transaction
          .select()
          .from(comments)
          .where(eq(comments.id, command.commentId))
          .limit(1)
          .for("update");
        if (!target) {
          throw new CommentError(
            "MODERATION_COMMENT_NOT_FOUND",
            404,
            "The Comment does not exist.",
          );
        }
        const [aggregate] = await transaction
          .select({ score: sum(commentReports.weight), reporters: count() })
          .from(commentReports)
          .where(
            and(eq(commentReports.commentId, command.commentId), eq(commentReports.counted, true)),
          );
        const reportScore = Number(aggregate?.score ?? 0);
        const reporterCount = aggregate?.reporters ?? 0;

        let publicationState: typeof target.publicationState = target.publicationState;
        let visibility: typeof target.visibility = target.visibility;
        let integrityState: typeof target.integrityState = target.integrityState;
        if (command.action === "COLLAPSE") visibility = "COLLAPSED";
        if (command.action === "HIDE") {
          publicationState = "PENDING_HUMAN_REVIEW";
          visibility = "HIDDEN";
          integrityState = "REVIEW";
        }
        if (command.action === "REMOVE_POLICY") {
          publicationState = "PUBLISHED";
          visibility = "REMOVED_POLICY";
          integrityState = "REJECTED";
        }
        if (command.action === "RESTORE") {
          publicationState = "PUBLISHED";
          visibility = "VISIBLE";
          integrityState = "NORMAL";
        }

        await transaction
          .update(comments)
          .set({
            publicationState,
            visibility,
            integrityState,
            ...(command.action === "RESTORE"
              ? { reportScoreBaseline: reportScore, reporterCountBaseline: reporterCount }
              : {}),
            version: sql`${comments.version} + 1`,
            updatedAt: now,
          })
          .where(eq(comments.id, command.commentId));
        const [decision] = await transaction
          .insert(commentModerationDecisions)
          .values({
            commentId: command.commentId,
            revision: sql`(select coalesce(max(revision), 0) + 1 from comment_moderation_decisions where comment_id = ${command.commentId})`,
            action: command.action,
            source: "INTERNAL_MODERATOR",
            reasonCode: command.reasonCode,
            fromPublicationState: target.publicationState,
            toPublicationState: publicationState,
            fromVisibility: target.visibility,
            toVisibility: visibility,
            fromIntegrityState: target.integrityState,
            toIntegrityState: integrityState,
            evidence: { report_score: reportScore, reporter_count: reporterCount },
            decidedAt: now,
          })
          .returning({ id: commentModerationDecisions.id });
        const eventId = randomUUID();
        await transaction.insert(outboxEvents).values({
          id: eventId,
          aggregateType: "COMMENT",
          aggregateId: command.commentId,
          eventType: "COMMENT_MODERATION_DECIDED",
          schemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt: now,
          payload: {
            event_id: eventId,
            event_type: "COMMENT_MODERATION_DECIDED",
            schema_version: EVENT_SCHEMA_VERSION,
            occurred_at: now.toISOString(),
            aggregate_type: "COMMENT",
            aggregate_id: command.commentId,
            data: {
              action: command.action,
              reason_code: command.reasonCode,
              publication_state: publicationState,
              visibility,
              integrity_state: integrityState,
            },
          },
        });
        return {
          decisionId: decision!.id,
          comment: {
            id: command.commentId,
            publicationState,
            visibility,
            integrityState,
          },
        };
      });
    },
  };
}

export const createCommentReadService = createCommentService;
