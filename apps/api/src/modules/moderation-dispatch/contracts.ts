import { randomUUID } from "node:crypto";

import { z } from "zod";

export const MODERATION_EVENT_SCHEMA_VERSION = 1;
export const MODERATION_POLICY_VERSION = "moderation-shadow-v1";

export const moderationTargetTypeSchema = z.enum([
  "COMMENT_VERSION",
  "ISSUE_VERSION",
  "ISSUE_MEDIA_ASSET",
]);

export type ModerationTargetType = z.infer<typeof moderationTargetTypeSchema>;

const privateReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/^https?:\/\//iu.test(value), "A public URL is not a private reference.");

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const moderationRequestDataSchema = z.object({
  source_event_id: z.string().uuid(),
  target_type: moderationTargetTypeSchema,
  target_id: z.string().uuid(),
  target_version: z.number().int().positive(),
  private_object_reference: privateReferenceSchema,
  normalized_input_hash: hashSchema,
  policy_version: z.string().min(1).max(64),
  reason: z.enum([
    "CREATE",
    "EDIT",
    "REPLACEMENT",
    "POLICY_CHANGE",
    "APPEAL",
    "RIGHTS",
    "BACKFILL",
  ]),
  mode: z.literal("SHADOW"),
});

const submittedDataSchema = moderationRequestDataSchema.omit({
  source_event_id: true,
  policy_version: true,
  reason: true,
  mode: true,
});

export const moderationSubmittedEventSchema = z.discriminatedUnion("event_type", [
  z.object({
    event_id: z.string().uuid(),
    event_type: z.literal("COMMENT_VERSION_SUBMITTED"),
    schema_version: z.literal(MODERATION_EVENT_SCHEMA_VERSION),
    occurred_at: z.string().datetime(),
    aggregate_type: z.literal("COMMENT_VERSION"),
    aggregate_id: z.string(),
    data: submittedDataSchema.extend({ target_type: z.literal("COMMENT_VERSION") }),
  }),
  z.object({
    event_id: z.string().uuid(),
    event_type: z.literal("ISSUE_VERSION_SUBMITTED"),
    schema_version: z.literal(MODERATION_EVENT_SCHEMA_VERSION),
    occurred_at: z.string().datetime(),
    aggregate_type: z.literal("ISSUE_VERSION"),
    aggregate_id: z.string(),
    data: submittedDataSchema.extend({ target_type: z.literal("ISSUE_VERSION") }),
  }),
  z.object({
    event_id: z.string().uuid(),
    event_type: z.literal("ISSUE_MEDIA_ASSET_SUBMITTED"),
    schema_version: z.literal(MODERATION_EVENT_SCHEMA_VERSION),
    occurred_at: z.string().datetime(),
    aggregate_type: z.literal("ISSUE_MEDIA_ASSET"),
    aggregate_id: z.string(),
    data: submittedDataSchema.extend({ target_type: z.literal("ISSUE_MEDIA_ASSET") }),
  }),
]);

export const moderationRequestedEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.literal("MODERATION_REQUESTED"),
  schema_version: z.literal(MODERATION_EVENT_SCHEMA_VERSION),
  occurred_at: z.string().datetime(),
  aggregate_type: z.literal("MODERATION_TARGET"),
  aggregate_id: z.string(),
  data: moderationRequestDataSchema,
});

export type ModerationRequestedEvent = z.infer<typeof moderationRequestedEventSchema>;

export type ModerationSubmissionInput = {
  targetType: ModerationTargetType;
  targetId: string;
  targetVersion: number;
  privateObjectReference: string;
  normalizedInputHash: string;
  policyVersion?: string;
  reason: "CREATE" | "EDIT" | "REPLACEMENT" | "POLICY_CHANGE" | "APPEAL" | "RIGHTS" | "BACKFILL";
  occurredAt?: Date;
};

const submittedEventType: Record<ModerationTargetType, string> = {
  COMMENT_VERSION: "COMMENT_VERSION_SUBMITTED",
  ISSUE_VERSION: "ISSUE_VERSION_SUBMITTED",
  ISSUE_MEDIA_ASSET: "ISSUE_MEDIA_ASSET_SUBMITTED",
};

export function createModerationSubmissionEvents(input: ModerationSubmissionInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const sourceEventId = randomUUID();
  const requestEventId = randomUUID();
  const aggregateId = `${input.targetType}:${input.targetId}:${input.targetVersion}`;
  const common = {
    target_type: input.targetType,
    target_id: input.targetId,
    target_version: input.targetVersion,
    private_object_reference: input.privateObjectReference,
    normalized_input_hash: input.normalizedInputHash,
  };
  const domainEventType = submittedEventType[input.targetType];
  const sourceEvent = {
    id: sourceEventId,
    aggregateType: input.targetType,
    aggregateId,
    eventType: domainEventType,
    schemaVersion: MODERATION_EVENT_SCHEMA_VERSION,
    occurredAt,
    availableAt: occurredAt,
    payload: {
      event_id: sourceEventId,
      event_type: domainEventType,
      schema_version: MODERATION_EVENT_SCHEMA_VERSION,
      occurred_at: occurredAt.toISOString(),
      aggregate_type: input.targetType,
      aggregate_id: aggregateId,
      data: common,
    },
  };
  moderationSubmittedEventSchema.parse(sourceEvent.payload);
  const requestEvent = {
    id: requestEventId,
    aggregateType: "MODERATION_TARGET",
    aggregateId,
    eventType: "MODERATION_REQUESTED",
    schemaVersion: MODERATION_EVENT_SCHEMA_VERSION,
    occurredAt,
    availableAt: occurredAt,
    payload: {
      event_id: requestEventId,
      event_type: "MODERATION_REQUESTED",
      schema_version: MODERATION_EVENT_SCHEMA_VERSION,
      occurred_at: occurredAt.toISOString(),
      aggregate_type: "MODERATION_TARGET",
      aggregate_id: aggregateId,
      data: {
        source_event_id: sourceEventId,
        ...common,
        policy_version: input.policyVersion ?? MODERATION_POLICY_VERSION,
        reason: input.reason,
        mode: "SHADOW",
      },
    } satisfies ModerationRequestedEvent,
  };
  return { sourceEvent, requestEvent, rows: [sourceEvent, requestEvent] };
}

export type ModerationShadowInspection = {
  status: "SUCCEEDED" | "SKIPPED";
  result: Record<string, unknown>;
  latencyMs: number;
  costMicros: number;
};

export type ModerationShadowAdapter = {
  provider: string;
  modelName: string;
  modelVersion: string;
  cacheTtlMilliseconds: number;
  inspect(input: {
    targetType: ModerationTargetType;
    targetId: string;
    targetVersion: number;
    privateObjectReference: string;
    normalizedInputHash: string;
    policyVersion: string;
  }): Promise<ModerationShadowInspection>;
};
