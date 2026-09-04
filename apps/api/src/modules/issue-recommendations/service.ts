import { createHash } from "node:crypto";

import { and, count, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueRecommendations,
  issues,
  memberSessions,
  members,
} from "../../database/schema/index.js";
import type { IssueRecommendationService } from "./contracts.js";

export class IssueRecommendationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createIssueRecommendationService(
  database: Database["db"],
): IssueRecommendationService {
  return {
    async set(command) {
      const now = new Date();
      return database.transaction(async (transaction) => {
        const [session] = await transaction
          .select({ memberId: memberSessions.memberId })
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
          throw new IssueRecommendationError(
            "SESSION_REQUIRED",
            401,
            "질문을 추천하려면 Member 로그인이 필요합니다.",
          );
        }

        const [issue] = await transaction
          .select({ id: issues.id })
          .from(issues)
          .where(
            and(
              eq(issues.id, command.issueId),
              eq(issues.lifecycle, "PUBLISHED"),
              eq(issues.visibility, "VISIBLE"),
            ),
          )
          .limit(1);
        if (!issue) {
          throw new IssueRecommendationError(
            "ISSUE_NOT_AVAILABLE",
            404,
            "추천할 수 있는 공개 질문을 찾지 못했습니다.",
          );
        }

        await transaction
          .insert(issueRecommendations)
          .values({
            issueId: command.issueId,
            memberId: session.memberId,
            active: command.active,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [issueRecommendations.issueId, issueRecommendations.memberId],
            set: { active: command.active, updatedAt: now },
          });

        const [aggregate] = await transaction
          .select({ value: count() })
          .from(issueRecommendations)
          .where(
            and(
              eq(issueRecommendations.issueId, command.issueId),
              eq(issueRecommendations.active, true),
            ),
          );

        return {
          recommendation: {
            active: command.active,
            count: Number(aggregate?.value ?? 0),
          },
        };
      });
    },
  };
}
