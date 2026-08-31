import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { outboxEvents } from "../../database/schema/index.js";

export const SUBMISSION_WAKEUP = "MODERATION_JOB_REQUESTED";

// Created in the submission transaction, only once both private images are attached.
// No content, images, credentials or client-selected job configuration enter this event.
export function submissionWakeup(id: string, revision: number, hasPair: boolean) {
  if (!hasPair) return [];
  const hash = createHash("sha256").update(`${SUBMISSION_WAKEUP}:${id}:${revision}`).digest("hex");
  return [
    {
      id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      aggregateType: "ISSUE_SUBMISSION",
      aggregateId: id,
      eventType: SUBMISSION_WAKEUP,
      schemaVersion: 1,
      payload: { submissionId: id, revision },
    },
  ];
}

export function hasClaimedWakeup(id: unknown, revision: unknown) {
  return sql`exists (select 1 from ${outboxEvents} w
    where w.event_type = ${SUBMISSION_WAKEUP} and w.aggregate_id = (${id})::text
      and w.payload->>'revision' = (${revision})::text
      and w.status = 'PENDING' and w.claim_token is not null and w.available_at > now())`;
}
