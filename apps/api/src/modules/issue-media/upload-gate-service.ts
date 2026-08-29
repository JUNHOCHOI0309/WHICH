import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, gte, isNull, ne, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueMediaAssets,
  issueMediaUploadSessions,
  memberCapabilityGrants,
  memberIssueSubmissions,
  memberMediaConsents,
} from "../../database/schema/index.js";

import {
  evaluateIssueMediaUploadGate,
  ISSUE_MEDIA_UPLOAD_LIMITS,
  ISSUE_MEDIA_UPLOAD_POLICY_VERSION,
  uploadActorPseudonym,
  type IssueMediaUploadGateReason,
} from "./upload-gate-policy.js";

export class IssueMediaUploadGateError extends Error {
  constructor(
    public readonly code:
      "MEDIA_UPLOAD_NOT_AVAILABLE" | "MEDIA_UPLOAD_SESSION_INVALID" | "MEDIA_UPLOAD_TOO_LARGE",
    public readonly statusCode: 403 | 409 | 413,
    message: string,
    public readonly reasons: IssueMediaUploadGateReason[] = [],
  ) {
    super(message);
    this.name = "IssueMediaUploadGateError";
  }
}

export interface IssueMediaUploadGateService {
  createSession(input: {
    memberId: string;
    submissionId: string;
    consentVersion: string;
    ipAddress: string;
  }): Promise<{
    id: string;
    token: string;
    objectKey: string;
    maxBytes: number;
    expiresAt: string;
    policyVersion: string;
  }>;
  consumeSession(input: {
    memberId: string;
    sessionId: string;
    token: string;
    byteSize: number;
  }): Promise<{ objectKey: string }>;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function countOf(row: { count: number | string } | undefined) {
  return Number(row?.count ?? 0);
}

export function createIssueMediaUploadGateService(
  database: Database["db"],
  options: {
    mode: "OFF" | "PILOT";
    consentVersion: string;
    pseudonymSecret: string;
  },
): IssueMediaUploadGateService {
  return {
    async createSession(input) {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
      const memberPseudonym = uploadActorPseudonym(
        "member",
        input.memberId,
        options.pseudonymSecret,
      );
      const ipPseudonym = uploadActorPseudonym("ip", input.ipAddress, options.pseudonymSecret);

      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`which:media-upload:${input.memberId}`}, 0))`,
        );
        const [capability, consent, submission, memberDaily, ipDaily, active, openAssets] =
          await Promise.all([
            transaction
              .select({ id: memberCapabilityGrants.id })
              .from(memberCapabilityGrants)
              .where(
                and(
                  eq(memberCapabilityGrants.memberId, input.memberId),
                  eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
                  eq(memberCapabilityGrants.state, "ACTIVE"),
                  gt(memberCapabilityGrants.expiresAt, now),
                ),
              )
              .limit(1),
            transaction
              .select({ id: memberMediaConsents.id })
              .from(memberMediaConsents)
              .where(
                and(
                  eq(memberMediaConsents.memberId, input.memberId),
                  eq(memberMediaConsents.consentVersion, options.consentVersion),
                  eq(memberMediaConsents.consentVersion, input.consentVersion),
                  isNull(memberMediaConsents.revokedAt),
                ),
              )
              .limit(1),
            transaction
              .select({
                memberId: memberIssueSubmissions.memberId,
                status: memberIssueSubmissions.status,
              })
              .from(memberIssueSubmissions)
              .where(eq(memberIssueSubmissions.id, input.submissionId))
              .limit(1),
            transaction
              .select({ count: sql<number>`count(*)::int` })
              .from(issueMediaUploadSessions)
              .where(
                and(
                  eq(issueMediaUploadSessions.memberPseudonym, memberPseudonym),
                  gte(issueMediaUploadSessions.createdAt, dayAgo),
                ),
              ),
            transaction
              .select({ count: sql<number>`count(*)::int` })
              .from(issueMediaUploadSessions)
              .where(
                and(
                  eq(issueMediaUploadSessions.ipPseudonym, ipPseudonym),
                  gte(issueMediaUploadSessions.createdAt, dayAgo),
                ),
              ),
            transaction
              .select({ count: sql<number>`count(*)::int` })
              .from(issueMediaUploadSessions)
              .where(
                and(
                  eq(issueMediaUploadSessions.memberId, input.memberId),
                  eq(issueMediaUploadSessions.state, "CREATED"),
                  gt(issueMediaUploadSessions.expiresAt, now),
                ),
              ),
            transaction
              .select({ count: sql<number>`count(*)::int` })
              .from(issueMediaAssets)
              .where(
                and(
                  eq(issueMediaAssets.uploadedByMemberId, input.memberId),
                  eq(issueMediaAssets.sourceType, "MEMBER_SUBMISSION"),
                  ne(issueMediaAssets.storageState, "PURGED"),
                ),
              ),
          ]);

        const gate = evaluateIssueMediaUploadGate({
          mode: options.mode,
          hasActiveCapability: Boolean(capability[0]),
          hasCurrentConsent: Boolean(consent[0]),
          ownsSubmission: submission[0]?.memberId === input.memberId,
          submissionStatus: submission[0]?.status ?? null,
          memberSessionsToday: countOf(memberDaily[0]),
          ipSessionsToday: countOf(ipDaily[0]),
          activeSessions: countOf(active[0]),
          openAssets: countOf(openAssets[0]),
        });
        if (!gate.allowed) {
          throw new IssueMediaUploadGateError(
            "MEDIA_UPLOAD_NOT_AVAILABLE",
            403,
            "Member image upload is not available for this account or submission.",
            gate.reasons,
          );
        }

        const id = randomUUID();
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(
          now.getTime() + ISSUE_MEDIA_UPLOAD_LIMITS.sessionTtlSeconds * 1_000,
        );
        const objectKey = `member-uploads/${input.memberId}/${id}/source`;
        await transaction.insert(issueMediaUploadSessions).values({
          id,
          memberId: input.memberId,
          submissionId: input.submissionId,
          objectKey,
          tokenHash: tokenHash(token),
          memberPseudonym,
          ipPseudonym,
          maxBytes: ISSUE_MEDIA_UPLOAD_LIMITS.maximumBytes,
          expiresAt,
        });
        return {
          id,
          token,
          objectKey,
          maxBytes: ISSUE_MEDIA_UPLOAD_LIMITS.maximumBytes,
          expiresAt: expiresAt.toISOString(),
          policyVersion: ISSUE_MEDIA_UPLOAD_POLICY_VERSION,
        };
      });
    },

    async consumeSession(input) {
      if (input.byteSize < 1 || input.byteSize > ISSUE_MEDIA_UPLOAD_LIMITS.maximumBytes) {
        throw new IssueMediaUploadGateError(
          "MEDIA_UPLOAD_TOO_LARGE",
          413,
          "Issue media must not exceed 10MB.",
        );
      }
      const now = new Date();
      const [consumed] = await database
        .update(issueMediaUploadSessions)
        .set({
          state: "CONSUMED",
          consumedBytes: input.byteSize,
          consumedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(issueMediaUploadSessions.id, input.sessionId),
            eq(issueMediaUploadSessions.memberId, input.memberId),
            eq(issueMediaUploadSessions.tokenHash, tokenHash(input.token)),
            eq(issueMediaUploadSessions.state, "CREATED"),
            gt(issueMediaUploadSessions.expiresAt, now),
            gte(issueMediaUploadSessions.maxBytes, input.byteSize),
          ),
        )
        .returning({ objectKey: issueMediaUploadSessions.objectKey });
      if (!consumed) {
        throw new IssueMediaUploadGateError(
          "MEDIA_UPLOAD_SESSION_INVALID",
          409,
          "The upload session is expired, already used, or does not match this Member.",
        );
      }
      return consumed;
    },
  };
}
