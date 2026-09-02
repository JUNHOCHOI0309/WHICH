import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  memberCapabilityEvents,
  memberCapabilityGrants,
  memberCredentials,
  members,
  operatorAuditLogs,
} from "../../database/schema/index.js";

// Deliberately different from the trusted-uploader publication policy: staging only.
export const UPLOAD_ONLY_POLICY_VERSION = "which-operator-upload-only-v1";
export const UPLOAD_ONLY_DURATION_DAYS = 30;

/** Host-admin CLI only. Never expose this eligibility exception through a Member/ops HTTP route. */
export async function decideUploadOnlyAccess(
  database: Database["db"],
  input: {
    memberId: string;
    action: "GRANT" | "REVOKE";
    rationale: string;
    actor: string;
    confirmMemberId?: string;
  },
) {
  const rationale = input.rationale.trim();
  if (!rationale || !input.actor.trim()) {
    throw new Error("An actor and rationale are required.");
  }
  if (input.confirmMemberId && input.confirmMemberId !== input.memberId) {
    throw new Error("Confirmation must exactly match the resolved Member ID.");
  }
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.memberId}))`);
    const [member] = await transaction
      .select({ status: members.status, verifiedAt: memberCredentials.emailVerifiedAt })
      .from(members)
      .leftJoin(memberCredentials, eq(memberCredentials.memberId, members.id))
      .where(eq(members.id, input.memberId))
      .for("update", { of: members });
    if (!member) throw new Error("The Member could not be found.");
    if (input.action === "GRANT" && (member.status !== "ACTIVE" || !member.verifiedAt)) {
      throw new Error("Upload-only access requires an active Member with a verified email.");
    }
    const [existing] = await transaction
      .select()
      .from(memberCapabilityGrants)
      .where(
        and(
          eq(memberCapabilityGrants.memberId, input.memberId),
          eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
        ),
      )
      .for("update");
    if (existing && existing.policyVersion !== UPLOAD_ONLY_POLICY_VERSION) {
      throw new Error("Use the existing Pilot workflow for a different capability policy.");
    }
    const now = new Date();
    const alreadyApplied =
      input.action === "GRANT"
        ? existing?.state === "ACTIVE" && existing.expiresAt > now
        : !existing || existing.state === "REVOKED";
    const result = {
      memberId: input.memberId,
      capabilityCode: "ISSUE_IMAGE_UPLOAD",
      policyVersion: UPLOAD_ONLY_POLICY_VERSION,
      action: input.action,
      durationDays: UPLOAD_ONLY_DURATION_DAYS,
      consentChanged: false,
      publicationChanged: false,
    };
    if (!input.confirmMemberId) return { ...result, mode: "DRY_RUN", changed: false };
    if (alreadyApplied) {
      return { ...result, mode: "APPLIED", changed: false, expiresAt: existing?.expiresAt };
    }
    const expiresAt = new Date(now.getTime() + UPLOAD_ONLY_DURATION_DAYS * 86_400_000);
    const [grant] =
      input.action === "GRANT"
        ? await transaction
            .insert(memberCapabilityGrants)
            .values({
              memberId: input.memberId,
              capabilityCode: "ISSUE_IMAGE_UPLOAD",
              state: "ACTIVE",
              policyVersion: UPLOAD_ONLY_POLICY_VERSION,
              reason: rationale,
              grantedAt: now,
              expiresAt,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [memberCapabilityGrants.memberId, memberCapabilityGrants.capabilityCode],
              set: {
                state: "ACTIVE",
                reason: rationale,
                grantedAt: now,
                expiresAt,
                updatedAt: now,
              },
              setWhere: eq(memberCapabilityGrants.policyVersion, UPLOAD_ONLY_POLICY_VERSION),
            })
            .returning()
        : await transaction
            .update(memberCapabilityGrants)
            .set({ state: "REVOKED", reason: rationale, updatedAt: now })
            .where(eq(memberCapabilityGrants.id, existing!.id))
            .returning();
    if (!grant) throw new Error("The capability decision was not saved.");
    await transaction.insert(memberCapabilityEvents).values({
      grantId: grant.id,
      action: input.action === "GRANT" ? "GRANTED" : "REVOKED",
      reasonCode: `OPS_UPLOAD_ONLY_${input.action}`,
      rationale,
    });
    await transaction.insert(operatorAuditLogs).values({
      memberId: input.memberId,
      eventType: `MEMBER_UPLOAD_ONLY_${input.action}`,
      outcome: "SUCCEEDED",
      metadata: {
        actor: input.actor,
        grantId: grant.id,
        policyVersion: UPLOAD_ONLY_POLICY_VERSION,
        rationale,
        consentChanged: false,
        publicationChanged: false,
      },
    });
    return { ...result, mode: "APPLIED", changed: true, expiresAt: grant.expiresAt };
  });
}
