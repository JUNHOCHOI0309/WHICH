import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoices,
  issues,
  issueVersions,
  voteAggregates,
} from "../../database/schema/index.js";
import type { IssueReadService, PublicIssueTally } from "./contracts.js";
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
  };
}
