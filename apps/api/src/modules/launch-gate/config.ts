import { z } from "zod";

import type { LaunchGateConfig, MigrationExpectation } from "./contracts.js";

const schema = z.object({
  LAUNCH_GATE_TARGET_ENVIRONMENT: z
    .enum(["development", "staging", "production"])
    .default("development"),
  LAUNCH_GATE_API_URL: z.string().url().default("http://localhost:4000"),
  LAUNCH_GATE_EXPECTED_RELEASE_ID: z.string().min(1).max(128),
  INTERNAL_AUTH_SECRET: z.string().min(16),
  OUTBOX_WEBHOOK_URL: z.string().url(),
  OUTBOX_WEBHOOK_SECRET: z.string().min(16),
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
  return {
    targetEnvironment: parsed.LAUNCH_GATE_TARGET_ENVIRONMENT,
    apiBaseUrl: parsed.LAUNCH_GATE_API_URL,
    expectedReleaseId: parsed.LAUNCH_GATE_EXPECTED_RELEASE_ID,
    internalAuthSecret: parsed.INTERNAL_AUTH_SECRET,
    outboxWebhookUrl: parsed.OUTBOX_WEBHOOK_URL,
    outboxWebhookSecret: parsed.OUTBOX_WEBHOOK_SECRET,
    issueId: parsed.LAUNCH_GATE_ISSUE_ID,
    issueVersion: parsed.LAUNCH_GATE_ISSUE_VERSION,
    maxDeadLetters: parsed.LAUNCH_GATE_MAX_DEAD_LETTERS,
    maxPendingAgeSeconds: parsed.LAUNCH_GATE_MAX_PENDING_AGE_SECONDS,
    expectedMigrations,
  };
}
