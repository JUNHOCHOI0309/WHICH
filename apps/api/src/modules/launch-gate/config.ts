import { z } from "zod";

import type { LaunchGateConfig, MigrationExpectation } from "./contracts.js";

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const schema = z.object({
  LAUNCH_GATE_TARGET_ENVIRONMENT: z
    .enum(["development", "staging", "production"])
    .default("development"),
  LAUNCH_GATE_API_URL: z.string().url().default("http://localhost:4000"),
  LAUNCH_GATE_PUBLIC_WEB_URL: z.string().url().optional(),
  WEB_ORIGIN: z.string().url().optional(),
  LAUNCH_GATE_EXPECTED_RELEASE_ID: z.string().min(1).max(128).optional(),
  INTERNAL_AUTH_SECRET: z.string().min(16),
  LAUNCH_GATE_OUTBOX_DELIVERY_REQUIRED: booleanString,
  OUTBOX_WEBHOOK_URL: z.string().url().optional(),
  OUTBOX_WEBHOOK_SECRET: z.string().min(16).optional(),
  LAUNCH_GATE_ISSUE_ID: z.string().uuid(),
  LAUNCH_GATE_ISSUE_VERSION: z.coerce.number().int().positive(),
  LAUNCH_GATE_MAX_DEAD_LETTERS: z.coerce.number().int().min(0).default(0),
  LAUNCH_GATE_MAX_PENDING_AGE_SECONDS: z.coerce.number().int().min(0).default(300),
});

export function getLaunchGateConfig(
  environment: NodeJS.ProcessEnv,
  expectedMigrations: MigrationExpectation[],
): LaunchGateConfig {
  const parsed = schema.parse(environment);
  const expectedReleaseId =
    parsed.LAUNCH_GATE_EXPECTED_RELEASE_ID ??
    environment.RENDER_GIT_COMMIT ??
    environment.RELEASE_ID;
  if (!expectedReleaseId) {
    throw new Error(
      "LAUNCH_GATE_EXPECTED_RELEASE_ID, RENDER_GIT_COMMIT, or RELEASE_ID is required.",
    );
  }
  return {
    targetEnvironment: parsed.LAUNCH_GATE_TARGET_ENVIRONMENT,
    apiBaseUrl: parsed.LAUNCH_GATE_API_URL,
    publicWebUrl: parsed.LAUNCH_GATE_PUBLIC_WEB_URL ?? parsed.WEB_ORIGIN ?? "http://localhost:3000",
    expectedReleaseId,
    internalAuthSecret: parsed.INTERNAL_AUTH_SECRET,
    outboxDeliveryRequired: parsed.LAUNCH_GATE_OUTBOX_DELIVERY_REQUIRED,
    outboxWebhookUrl: parsed.OUTBOX_WEBHOOK_URL ?? null,
    outboxWebhookSecret: parsed.OUTBOX_WEBHOOK_SECRET ?? null,
    issueId: parsed.LAUNCH_GATE_ISSUE_ID,
    issueVersion: parsed.LAUNCH_GATE_ISSUE_VERSION,
    maxDeadLetters: parsed.LAUNCH_GATE_MAX_DEAD_LETTERS,
    maxPendingAgeSeconds: parsed.LAUNCH_GATE_MAX_PENDING_AGE_SECONDS,
    expectedMigrations,
  };
}
