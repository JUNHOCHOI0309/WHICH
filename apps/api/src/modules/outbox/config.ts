import { z } from "zod";

const commonSchema = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://which:which_local@localhost:54329/which"),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(900_000).default(30_000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().min(100).max(3_600_000).default(5_000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().min(100).max(86_400_000).default(300_000),
    OUTBOX_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),
  })
  .superRefine((value, context) => {
    if (value.OUTBOX_RETRY_MAX_MS < value.OUTBOX_RETRY_BASE_MS) {
      context.addIssue({
        code: "custom",
        path: ["OUTBOX_RETRY_MAX_MS"],
        message: "OUTBOX_RETRY_MAX_MS must be greater than or equal to OUTBOX_RETRY_BASE_MS.",
      });
    }
    if (value.OUTBOX_LEASE_MS <= value.OUTBOX_HTTP_TIMEOUT_MS) {
      context.addIssue({
        code: "custom",
        path: ["OUTBOX_LEASE_MS"],
        message: "OUTBOX_LEASE_MS must be greater than OUTBOX_HTTP_TIMEOUT_MS.",
      });
    }
  });

const deliverySchema = z.object({
  OUTBOX_WEBHOOK_URL: z.string().url(),
  OUTBOX_WEBHOOK_SECRET: z.string().min(16),
});

export function getOutboxWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  requireDeliveryTarget = true,
) {
  const parsed = commonSchema.parse(environment);
  const delivery = requireDeliveryTarget ? deliverySchema.parse(environment) : null;
  return {
    databaseUrl: parsed.DATABASE_URL,
    batchSize: parsed.OUTBOX_BATCH_SIZE,
    pollIntervalMilliseconds: parsed.OUTBOX_POLL_INTERVAL_MS,
    publisher: {
      batchSize: parsed.OUTBOX_BATCH_SIZE,
      leaseMilliseconds: parsed.OUTBOX_LEASE_MS,
      maxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
      retryBaseMilliseconds: parsed.OUTBOX_RETRY_BASE_MS,
      retryMaxMilliseconds: parsed.OUTBOX_RETRY_MAX_MS,
    },
    delivery: delivery
      ? {
          url: delivery.OUTBOX_WEBHOOK_URL,
          secret: delivery.OUTBOX_WEBHOOK_SECRET,
          timeoutMilliseconds: parsed.OUTBOX_HTTP_TIMEOUT_MS,
        }
      : null,
  };
}
