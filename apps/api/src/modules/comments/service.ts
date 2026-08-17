import { and, desc, eq, inArray, isNull, lt, or, type SQL } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import { comments, issues, voterSubjects, votes } from "../../database/schema/index.js";
import type { CommentReadService } from "./contracts.js";
import { decodeCommentCursor, encodeCommentCursor } from "./cursor.js";
import { CommentReadError } from "./errors.js";

export function createCommentReadService(database: Database["db"]): CommentReadService {
  return {
    async listGuestComments(query) {
      const cursor = query.cursor ? decodeCommentCursor(query.cursor) : null;

      return database.transaction(async (transaction) => {
        if (!query.anonymousSubjectId) {
          throw new CommentReadError(
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
          throw new CommentReadError(
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
          throw new CommentReadError(
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

        const commentsAvailable =
          issue &&
          ["PUBLISHED", "CLOSED", "ARCHIVED"].includes(issue.lifecycle) &&
          issue.visibility === "VISIBLE" &&
          ["PRE_VOTE_HIDDEN", "RESULT_VISIBLE"].includes(issue.resultVisibility) &&
          issue.riskLevel === "LOW" &&
          !issue.isPolitical;

        if (!commentsAvailable) {
          throw new CommentReadError(
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

        if (query.side !== "ALL") {
          filters.push(eq(comments.choice, query.side));
        }

        if (cursor) {
          filters.push(
            or(
              lt(comments.createdAt, cursor.createdAt),
              and(eq(comments.createdAt, cursor.createdAt), lt(comments.id, cursor.commentId)),
            )!,
          );
        }

        const rows = await transaction
          .select({
            id: comments.id,
            choice: comments.choice,
            authorDisplayName: comments.authorDisplayName,
            body: comments.body,
            threadState: comments.threadState,
            createdAt: comments.createdAt,
            editedAt: comments.editedAt,
          })
          .from(comments)
          .where(and(...filters))
          .orderBy(desc(comments.createdAt), desc(comments.id))
          .limit(query.limit + 1);

        const hasMore = rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const lastItem = pageRows.at(-1);

        return {
          items: pageRows.map((row) => ({
            id: row.id,
            choice: row.choice,
            author: { displayName: row.authorDisplayName },
            body: row.body,
            threadState: row.threadState,
            createdAt: row.createdAt.toISOString(),
            editedAt: row.editedAt?.toISOString() ?? null,
          })),
          nextCursor:
            hasMore && lastItem
              ? encodeCommentCursor({ createdAt: lastItem.createdAt, commentId: lastItem.id })
              : null,
        };
      });
    },
  };
}
