import {
  and,
  desc,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoices,
  issues,
  issueVersions,
  voteAggregates,
  voterSubjects,
  votes,
} from "../../database/schema/index.js";
import type { IssueReadService, PublicIssueTally } from "./contracts.js";
import { decodeIssueFeedCursor, encodeIssueFeedCursor } from "./cursor.js";
import { IssueReadError } from "./errors.js";
import { isGuestIssueAvailable } from "./policy.js";

export function createIssueReadService(database: Database["db"]): IssueReadService {
  return {
    async getGuestIssue(issueId) {
      return database.transaction(async (transaction) => {
        const [issue] = await transaction
          .select({
            id: issues.id,
            lifecycle: issues.lifecycle,
            visibility: issues.visibility,
            participation: issues.participation,
            riskLevel: issues.riskLevel,
            isPolitical: issues.isPolitical,
            voteOpenAt: issues.voteOpenAt,
            voteCloseAt: issues.voteCloseAt,
            resultVisibility: issues.resultVisibility,
          })
          .from(issues)
          .where(eq(issues.id, issueId))
          .limit(1);

        if (!issue) {
          throw new IssueReadError("ISSUE_NOT_FOUND", 404, "The requested Issue does not exist.");
        }

        if (!isGuestIssueAvailable(issue, new Date())) {
          throw new IssueReadError(
            "ISSUE_NOT_AVAILABLE",
            409,
            "The requested Issue is not currently available to Guests.",
          );
        }

        const [version] = await transaction
          .select({
            version: issueVersions.version,
            question: issueVersions.question,
            context: issueVersions.context,
            publishedAt: issueVersions.publishedAt,
            categoryCode: issueVersions.primaryCategoryCode,
            experienceModeCode: issueVersions.experienceModeCode,
          })
          .from(issueVersions)
          .where(and(eq(issueVersions.issueId, issueId), isNotNull(issueVersions.publishedAt)))
          .orderBy(desc(issueVersions.version))
          .limit(1);

        if (!version?.publishedAt) {
          throw new IssueReadError(
            "ISSUE_NOT_AVAILABLE",
            409,
            "The requested Issue has no published Version available.",
          );
        }

        const choices = await transaction
          .select({
            id: issueChoices.id,
            code: issueChoices.code,
            label: issueChoices.label,
          })
          .from(issueChoices)
          .where(
            and(eq(issueChoices.issueId, issueId), eq(issueChoices.issueVersion, version.version)),
          )
          .orderBy(issueChoices.code);

        if (choices.length !== 2 || choices[0]?.code !== "A" || choices[1]?.code !== "B") {
          throw new IssueReadError(
            "ISSUE_NOT_AVAILABLE",
            409,
            "The requested Issue does not have a complete A/B Choice set.",
          );
        }

        let tally: PublicIssueTally | null = null;
        if (issue.resultVisibility === "RESULT_VISIBLE") {
          const [aggregate] = await transaction
            .select()
            .from(voteAggregates)
            .where(
              and(
                eq(voteAggregates.issueId, issueId),
                eq(voteAggregates.issueVersion, version.version),
              ),
            )
            .limit(1);

          if (aggregate) {
            tally = {
              resultVersion: aggregate.resultVersion,
              acceptedA: aggregate.acceptedACount,
              acceptedB: aggregate.acceptedBCount,
              displayedTotal: aggregate.displayedVoteCount,
              integrityState: aggregate.integrityState,
            };
          }
        }

        return {
          id: issue.id,
          version: version.version,
          question: version.question,
          context: version.context,
          publishedAt: version.publishedAt.toISOString(),
          categoryCode: version.categoryCode,
          experienceModeCode: version.experienceModeCode,
          choices,
          result: {
            visibility: issue.resultVisibility,
            tally,
          },
        };
      });
    },

    async listGuestIssues(query) {
      const cursor = query.cursor ? decodeIssueFeedCursor(query.cursor) : null;

      return database.transaction(async (transaction) => {
        const now = new Date();
        const latestPublishedVersions = transaction
          .selectDistinctOn([issueVersions.issueId], {
            issueId: issueVersions.issueId,
            version: issueVersions.version,
            question: issueVersions.question,
            publishedAt: issueVersions.publishedAt,
            categoryCode: issueVersions.primaryCategoryCode,
          })
          .from(issueVersions)
          .where(and(isNotNull(issueVersions.publishedAt), lte(issueVersions.publishedAt, now)))
          .orderBy(issueVersions.issueId, desc(issueVersions.version))
          .as("latest_published_versions");

        const filters: SQL[] = [
          eq(issues.lifecycle, "PUBLISHED"),
          eq(issues.visibility, "VISIBLE"),
          eq(issues.participation, "VOTING_OPEN"),
          eq(issues.feedEligibility, "ELIGIBLE"),
          eq(issues.riskLevel, "LOW"),
          eq(issues.isPolitical, false),
          or(isNull(issues.voteOpenAt), lte(issues.voteOpenAt, now))!,
          or(isNull(issues.voteCloseAt), gt(issues.voteCloseAt, now))!,
          exists(
            transaction
              .select({ id: issueChoices.id })
              .from(issueChoices)
              .where(
                and(
                  eq(issueChoices.issueId, issues.id),
                  eq(issueChoices.issueVersion, latestPublishedVersions.version),
                  eq(issueChoices.code, "A"),
                ),
              ),
          ),
          exists(
            transaction
              .select({ id: issueChoices.id })
              .from(issueChoices)
              .where(
                and(
                  eq(issueChoices.issueId, issues.id),
                  eq(issueChoices.issueVersion, latestPublishedVersions.version),
                  eq(issueChoices.code, "B"),
                ),
              ),
          ),
        ];

        if (query.excludeIssueId) {
          filters.push(ne(issues.id, query.excludeIssueId));
        }

        if (cursor) {
          filters.push(
            or(
              lt(latestPublishedVersions.publishedAt, cursor.publishedAt),
              and(
                eq(latestPublishedVersions.publishedAt, cursor.publishedAt),
                lt(issues.id, cursor.issueId),
              ),
            )!,
          );
        }

        if (query.anonymousSubjectId) {
          const [subject] = await transaction
            .select({ id: voterSubjects.id })
            .from(voterSubjects)
            .where(eq(voterSubjects.anonymousSubjectId, query.anonymousSubjectId))
            .limit(1);

          if (subject) {
            filters.push(
              notExists(
                transaction
                  .select({ id: votes.id })
                  .from(votes)
                  .where(
                    and(
                      eq(votes.issueId, issues.id),
                      eq(votes.subjectId, subject.id),
                      eq(votes.integrityState, "ACCEPTED"),
                    ),
                  ),
              ),
            );
          }
        }

        const rows = await transaction
          .select({
            id: issues.id,
            version: latestPublishedVersions.version,
            question: latestPublishedVersions.question,
            publishedAt: latestPublishedVersions.publishedAt,
            categoryCode: latestPublishedVersions.categoryCode,
          })
          .from(issues)
          .innerJoin(latestPublishedVersions, eq(latestPublishedVersions.issueId, issues.id))
          .where(and(...filters))
          .orderBy(desc(latestPublishedVersions.publishedAt), desc(issues.id))
          .limit(query.limit + 1);

        const hasMore = rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const choiceFilters = pageRows.map((row) =>
          and(eq(issueChoices.issueId, row.id), eq(issueChoices.issueVersion, row.version)),
        );
        const choices = choiceFilters.length
          ? await transaction
              .select({
                id: issueChoices.id,
                issueId: issueChoices.issueId,
                issueVersion: issueChoices.issueVersion,
                code: issueChoices.code,
                label: issueChoices.label,
              })
              .from(issueChoices)
              .where(or(...choiceFilters))
              .orderBy(issueChoices.issueId, issueChoices.code)
          : [];

        const items = pageRows.map((row) => ({
          id: row.id,
          version: row.version,
          question: row.question,
          publishedAt: row.publishedAt!.toISOString(),
          categoryCode: row.categoryCode,
          choices: choices
            .filter((choice) => choice.issueId === row.id && choice.issueVersion === row.version)
            .map(({ id, code, label }) => ({ id, code, label })),
        }));
        const lastItem = pageRows.at(-1);

        return {
          items,
          nextCursor:
            hasMore && lastItem?.publishedAt
              ? encodeIssueFeedCursor({
                  publishedAt: lastItem.publishedAt,
                  issueId: lastItem.id,
                })
              : null,
        };
      });
    },
  };
}
