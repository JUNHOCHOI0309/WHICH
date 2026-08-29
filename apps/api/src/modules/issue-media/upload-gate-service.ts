import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, gte, isNull, ne, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueMediaAssets,
  issueMediaUploadSessions,
  memberCapabilityGrants,
  memberCapabilityEvents,
  memberIssueSubmissions,
  memberMediaConsents,
  operatorAccessGrants,
} from "../../database/schema/index.js";

import {
  evaluateIssueMediaUploadGate,
  ISSUE_MEDIA_UPLOAD_LIMITS,
  ISSUE_MEDIA_UPLOAD_POLICY_VERSION,
  uploadActorPseudonym,
  type IssueMediaUploadGateReason,
} from "./upload-gate-policy.js";
import {
  evaluateTrustedUploaderEligibility,
  TRUSTED_IMAGE_UPLOADER_LIMITS,
  TRUSTED_IMAGE_UPLOADER_POLICY_VERSION,
  type TrustedUploaderEligibilityReason,
} from "./trusted-uploader-policy.js";

export type IssueMediaUploadAccess = {
  mode: "OFF" | "PILOT";
  allowed: boolean;
  consentVersion: string;
  reasons: Array<"MODE_DISABLED" | "CAPABILITY_REQUIRED" | "CONSENT_REQUIRED">;
  capability: {
    state: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";
    expiresAt: string;
  } | null;
  limits: {
    dailyUploads: number;
    maximumOpenAssets: number;
    maximumBytes: number;
  };
};

export type TrustedUploaderPilotMember = {
  memberId: string;
  displayName: string;
  status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
  email: string | null;
  createdAt: string;
  metrics: {
    accountAgeDays: number;
    acceptedVotes: number;
    publishedLowRiskIssues: number;
    confirmedViolations90d: number;
  };
  consentCurrent: boolean;
  eligible: boolean;
  eligibilityReasons: TrustedUploaderEligibilityReason[];
  capability: {
    state: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";
    expiresAt: string;
    reason: string;
  } | null;
};

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
  readAccess(memberId: string): Promise<IssueMediaUploadAccess>;
  acceptConsent(memberId: string): Promise<IssueMediaUploadAccess>;
  listPilotMembers(input: {
    operatorMemberId: string;
    query?: string;
    limit: number;
  }): Promise<{ items: TrustedUploaderPilotMember[] } | null>;
  decidePilotCapability(input: {
    operatorMemberId: string;
    targetMemberId: string;
    action: "GRANT" | "SUSPEND" | "REVOKE" | "RESTORE";
    rationale: string;
    requestId?: string;
  }): Promise<TrustedUploaderPilotMember | null>;
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
    moderationCapacity?: () => Promise<{ allowed: boolean }>;
  },
): IssueMediaUploadGateService {
  async function operatorAllowed(memberId: string) {
    const [grant] = await database
      .select({ id: operatorAccessGrants.id })
      .from(operatorAccessGrants)
      .where(
        and(
          eq(operatorAccessGrants.memberId, memberId),
          eq(operatorAccessGrants.role, "OPERATOR"),
          isNull(operatorAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    return Boolean(grant);
  }

  async function expireGrant(memberId: string) {
    const now = new Date();
    const [expired] = await database
      .update(memberCapabilityGrants)
      .set({ state: "EXPIRED", updatedAt: now })
      .where(
        and(
          eq(memberCapabilityGrants.memberId, memberId),
          eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
          eq(memberCapabilityGrants.state, "ACTIVE"),
          sql`${memberCapabilityGrants.expiresAt} <= ${now}`,
        ),
      )
      .returning({ id: memberCapabilityGrants.id });
    if (expired) {
      await database.insert(memberCapabilityEvents).values({
        grantId: expired.id,
        action: "EXPIRED",
        reasonCode: "GRANT_TTL_EXPIRED",
        rationale: "The 30-day trusted uploader Pilot grant expired automatically.",
      });
    }
  }

  async function readAccess(memberId: string): Promise<IssueMediaUploadAccess> {
    await expireGrant(memberId);
    const now = new Date();
    const [capability, consent] = await Promise.all([
      database
        .select({
          state: memberCapabilityGrants.state,
          expiresAt: memberCapabilityGrants.expiresAt,
        })
        .from(memberCapabilityGrants)
        .where(
          and(
            eq(memberCapabilityGrants.memberId, memberId),
            eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
          ),
        )
        .limit(1),
      database
        .select({ id: memberMediaConsents.id })
        .from(memberMediaConsents)
        .where(
          and(
            eq(memberMediaConsents.memberId, memberId),
            eq(memberMediaConsents.consentVersion, options.consentVersion),
            isNull(memberMediaConsents.revokedAt),
          ),
        )
        .limit(1),
    ]);
    const active = capability[0]?.state === "ACTIVE" && capability[0].expiresAt > now;
    const reasons: IssueMediaUploadAccess["reasons"] = [];
    if (options.mode !== "PILOT") reasons.push("MODE_DISABLED");
    if (!active) reasons.push("CAPABILITY_REQUIRED");
    if (!consent[0]) reasons.push("CONSENT_REQUIRED");
    return {
      mode: options.mode,
      allowed: reasons.length === 0,
      consentVersion: options.consentVersion,
      reasons,
      capability: capability[0]
        ? {
            state: capability[0].state as NonNullable<
              IssueMediaUploadAccess["capability"]
            >["state"],
            expiresAt: capability[0].expiresAt.toISOString(),
          }
        : null,
      limits: {
        dailyUploads: ISSUE_MEDIA_UPLOAD_LIMITS.dailySessionsPerMember,
        maximumOpenAssets: ISSUE_MEDIA_UPLOAD_LIMITS.maximumOpenAssets,
        maximumBytes: ISSUE_MEDIA_UPLOAD_LIMITS.maximumBytes,
      },
    };
  }

  async function pilotMembers(query: string | undefined, limit: number) {
    const normalizedQuery = query?.trim().toLowerCase() ?? "";
    const search = `%${normalizedQuery}%`;
    const result = await database.execute<{
      member_id: string;
      display_name: string;
      status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
      email: string | null;
      created_at: Date;
      email_verified_at: Date | null;
      accepted_votes: number;
      published_low_risk_issues: number;
      confirmed_violations_90d: number;
      consent_current: boolean;
      capability_state: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED" | null;
      capability_expires_at: Date | null;
      capability_reason: string | null;
    }>(sql`
      select m.member_id, m.display_name, m.status, mc.email_normalized as email,
        m.created_at, mc.email_verified_at,
        (select count(*)::int from votes v
          join voter_subjects vs on vs.subject_id = v.subject_id
          where vs.user_id = m.member_id and v.integrity_state = 'ACCEPTED') as accepted_votes,
        (select count(*)::int from issue_authors ia
          join issues i on i.issue_id = ia.issue_id
          where ia.member_id = m.member_id and i.lifecycle = 'PUBLISHED'
            and i.risk_level = 'LOW') as published_low_risk_issues,
        (select count(*)::int from issue_media_assets ima
          where ima.uploaded_by_member_id = m.member_id
            and ima.moderation_state in ('REJECTED', 'REVOKED')
            and ima.updated_at >= now() - interval '90 days') as confirmed_violations_90d,
        exists(select 1 from member_media_consents mmc
          where mmc.member_id = m.member_id
            and mmc.consent_version = ${options.consentVersion}
            and mmc.revoked_at is null) as consent_current,
        mcg.state as capability_state, mcg.expires_at as capability_expires_at,
        mcg.reason as capability_reason
      from members m
      left join member_credentials mc on mc.member_id = m.member_id
      left join member_capability_grants mcg on mcg.member_id = m.member_id
        and mcg.capability_code = 'ISSUE_IMAGE_UPLOAD'
      where (${search} = '%%' or m.member_id::text = ${normalizedQuery}
        or lower(m.display_name) like ${search}
        or lower(coalesce(mc.email_normalized, '')) like ${search})
      order by (mcg.state = 'ACTIVE' and mcg.expires_at > now()) desc, m.created_at desc
      limit ${Math.max(1, Math.min(limit, 100))}
    `);
    const now = Date.now();
    return result.rows.map((row) => {
      const createdAt = new Date(row.created_at);
      const capabilityExpiresAt = row.capability_expires_at
        ? new Date(row.capability_expires_at)
        : null;
      const capabilityState =
        row.capability_state === "ACTIVE" &&
        capabilityExpiresAt &&
        capabilityExpiresAt.getTime() <= now
          ? "EXPIRED"
          : row.capability_state;
      const accountAgeDays = Math.floor((now - createdAt.getTime()) / 86_400_000);
      const evaluation = evaluateTrustedUploaderEligibility({
        memberStatus: row.status,
        hasVerifiedEmail: Boolean(row.email_verified_at),
        accountAgeDays,
        acceptedVoteCount: Number(row.accepted_votes),
        publishedLowRiskIssueCount: Number(row.published_low_risk_issues),
        confirmedViolationCountInLookback: Number(row.confirmed_violations_90d),
        hasActiveRestriction: row.status !== "ACTIVE",
        acceptedCurrentRightsTerms: row.consent_current,
      });
      return {
        memberId: row.member_id,
        displayName: row.display_name,
        status: row.status,
        email: row.email,
        createdAt: createdAt.toISOString(),
        metrics: {
          accountAgeDays,
          acceptedVotes: Number(row.accepted_votes),
          publishedLowRiskIssues: Number(row.published_low_risk_issues),
          confirmedViolations90d: Number(row.confirmed_violations_90d),
        },
        consentCurrent: row.consent_current,
        eligible: evaluation.eligible,
        eligibilityReasons: evaluation.reasons,
        capability:
          capabilityState && capabilityExpiresAt
            ? {
                state: capabilityState,
                expiresAt: capabilityExpiresAt.toISOString(),
                reason: row.capability_reason ?? "",
              }
            : null,
      } satisfies TrustedUploaderPilotMember;
    });
  }

  return {
    readAccess,
    async acceptConsent(memberId) {
      const now = new Date();
      await database
        .insert(memberMediaConsents)
        .values({
          memberId,
          consentVersion: options.consentVersion,
          acceptedAt: now,
        })
        .onConflictDoUpdate({
          target: [memberMediaConsents.memberId, memberMediaConsents.consentVersion],
          set: { acceptedAt: now, revokedAt: null },
        });
      return readAccess(memberId);
    },
    async listPilotMembers(input) {
      if (!(await operatorAllowed(input.operatorMemberId))) return null;
      return { items: await pilotMembers(input.query, input.limit) };
    },
    async decidePilotCapability(input) {
      if (!(await operatorAllowed(input.operatorMemberId))) return null;
      await expireGrant(input.targetMemberId);
      const rationale = input.rationale.trim();
      if (rationale.length < 10 || rationale.length > 2000) {
        throw new IssueMediaUploadGateError(
          "MEDIA_UPLOAD_NOT_AVAILABLE",
          409,
          "Pilot capability decisions require a 10-2000 character rationale.",
        );
      }
      const [target] = await pilotMembers(input.targetMemberId, 1);
      if (!target) {
        throw new IssueMediaUploadGateError(
          "MEDIA_UPLOAD_NOT_AVAILABLE",
          409,
          "The Pilot candidate could not be found.",
        );
      }
      if (["GRANT", "RESTORE"].includes(input.action) && !target.eligible) {
        throw new IssueMediaUploadGateError(
          "MEDIA_UPLOAD_NOT_AVAILABLE",
          409,
          "The Member does not satisfy the trusted uploader eligibility policy.",
          ["CAPABILITY_REQUIRED"],
        );
      }
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + TRUSTED_IMAGE_UPLOADER_LIMITS.grantDurationDays * 86_400_000,
      );
      const nextState =
        input.action === "SUSPEND" ? "SUSPENDED" : input.action === "REVOKE" ? "REVOKED" : "ACTIVE";
      const [grant] = await database
        .insert(memberCapabilityGrants)
        .values({
          memberId: input.targetMemberId,
          capabilityCode: "ISSUE_IMAGE_UPLOAD",
          state: nextState,
          policyVersion: TRUSTED_IMAGE_UPLOADER_POLICY_VERSION,
          grantedByMemberId: input.operatorMemberId,
          reason: rationale,
          grantedAt: now,
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [memberCapabilityGrants.memberId, memberCapabilityGrants.capabilityCode],
          set: {
            state: nextState,
            policyVersion: TRUSTED_IMAGE_UPLOADER_POLICY_VERSION,
            grantedByMemberId: input.operatorMemberId,
            reason: rationale,
            grantedAt: now,
            expiresAt,
            updatedAt: now,
          },
        })
        .returning({ id: memberCapabilityGrants.id });
      if (!grant) throw new Error("Capability decision did not return a grant.");
      await database.insert(memberCapabilityEvents).values({
        grantId: grant.id,
        action:
          input.action === "GRANT"
            ? "GRANTED"
            : input.action === "RESTORE"
              ? "RESTORED"
              : input.action === "SUSPEND"
                ? "SUSPENDED"
                : "REVOKED",
        reasonCode: `OPS_${input.action}`,
        rationale,
        actorMemberId: input.operatorMemberId,
        requestId: input.requestId,
      });
      const [updated] = await pilotMembers(input.targetMemberId, 1);
      if (!updated) throw new Error("Updated Pilot capability could not be read.");
      return updated;
    },
    async createSession(input) {
      const capacity = await options.moderationCapacity?.();
      if (capacity && !capacity.allowed) {
        throw new IssueMediaUploadGateError(
          "MEDIA_UPLOAD_NOT_AVAILABLE",
          403,
          "New image uploads are temporarily paused while moderation capacity recovers.",
          ["MODERATION_CAPACITY_PAUSED"],
        );
      }
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
