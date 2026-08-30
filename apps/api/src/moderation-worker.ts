import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import { createPolicyJudgeService } from "./modules/policy-judge/service.js";
import { judgeDiagnostic, policyJudgeConfig } from "./modules/policy-judge/contracts.js";

import { createDatabase } from "./database/client.js";
import {
  createLocalEmbeddedTextExtractor,
  localMediaScannerConfig,
} from "./modules/issue-media/local-scan-detector.js";
import { LOCAL_SCAN_VERSION } from "./modules/issue-media/local-scan-contract.js";
import { EMBEDDED_TEXT_VERSION } from "./modules/issue-media/embedded-text.js";
import { readLatestPublicationReadiness } from "./modules/issue-media/publication-readiness-reader.js";
import { moderationDecisionRuntime } from "./modules/moderation/decision-runtime.js";
import {
  createR2IssueMediaStorage,
  issueMediaStorageConfig,
} from "./modules/issue-media/storage.js";
import { createModerationDispatcherService } from "./modules/moderation-dispatch/service.js";
import { createModerationProviderInputResolver } from "./modules/moderation-providers/input-resolver.js";
import { createOpenAiModerationAdapter } from "./modules/moderation-providers/openai-moderation-adapter.js";
import {
  createModerationProviderGate,
  moderationProviderRuntimeConfig,
  providerRuntimeDiagnostic,
} from "./modules/moderation-providers/runtime-gate.js";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ISSUE_MEDIA_CONSENT_VERSION: z.string().min(1).max(64).default("which-media-consent-v2"),
  MODERATION_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  MODERATION_WORKER_LEASE_MS: z.coerce.number().int().min(5_000).default(60_000),
  MODERATION_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  MODERATION_WORKER_RETRY_BASE_MS: z.coerce.number().int().min(100).default(5_000),
  MODERATION_WORKER_RETRY_MAX_MS: z.coerce.number().int().min(1_000).default(300_000),
  MODERATION_WORKER_POLL_MS: z.coerce.number().int().min(250).default(2_000),
});

const config = environmentSchema.parse(process.env);
if (config.MODERATION_WORKER_RETRY_MAX_MS < config.MODERATION_WORKER_RETRY_BASE_MS) {
  throw new Error("MODERATION_WORKER_RETRY_MAX_MS must be at least the retry base.");
}

const database = createDatabase(config.DATABASE_URL);
const publicationEvidence = {
  consentVersion: config.ISSUE_MEDIA_CONSENT_VERSION,
  decisionRuntime: moderationDecisionRuntime(),
};
const providerConfig = moderationProviderRuntimeConfig();
const mediaConfig = issueMediaStorageConfig();
const mediaStorage = mediaConfig ? createR2IssueMediaStorage(mediaConfig) : null;
const scannerConfig = localMediaScannerConfig();
if (
  scannerConfig.enabled &&
  config.MODERATION_WORKER_LEASE_MS <
    2 * scannerConfig.timeoutMs + providerConfig.OPENAI_MODERATION_TIMEOUT_MS + 5000
) {
  throw new Error(
    "MODERATION_WORKER_LEASE_MS must cover two local scans, the provider timeout, and 5000ms completion margin.",
  );
}
const resolveProviderInput = createModerationProviderInputResolver({
  database: database.db,
  storage: mediaStorage,
  extractEmbeddedText: createLocalEmbeddedTextExtractor({
    ...scannerConfig,
    workerUrl: new URL(
      import.meta.url.endsWith(".ts") ? "./local-media-scanner.ts" : "./local-media-scanner.js",
      import.meta.url,
    ),
    execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
  }),
});
const adapter =
  providerConfig.MODERATION_PROVIDER === "OPENAI_MODERATION" && providerConfig.OPENAI_API_KEY
    ? createOpenAiModerationAdapter({
        apiKey: providerConfig.OPENAI_API_KEY,
        model: providerConfig.OPENAI_MODERATION_MODEL,
        timeoutMs: providerConfig.OPENAI_MODERATION_TIMEOUT_MS,
        resolveInput: resolveProviderInput,
        embeddedTextEnabled: scannerConfig.enabled,
        cacheProfile: `${EMBEDDED_TEXT_VERSION}:${LOCAL_SCAN_VERSION}:${scannerConfig.enabled ? "LOCAL" : "OFF"}`,
      })
    : null;
const worker = createModerationDispatcherService(database.db, adapter, {
  batchSize: config.MODERATION_WORKER_BATCH_SIZE,
  leaseMilliseconds: config.MODERATION_WORKER_LEASE_MS,
  maxAttempts: config.MODERATION_WORKER_MAX_ATTEMPTS,
  retryBaseMilliseconds: config.MODERATION_WORKER_RETRY_BASE_MS,
  retryMaxMilliseconds: config.MODERATION_WORKER_RETRY_MAX_MS,
  providerGate: createModerationProviderGate({ database: database.db, config: providerConfig }),
  publicationEvidence,
});

const judgeConfig = policyJudgeConfig();
const policyJudge = createPolicyJudgeService({
  database: database.db,
  config: judgeConfig,
  provider: providerConfig,
  resolveInput: resolveProviderInput,
});

async function once() {
  const dispatched = await worker.dispatchBatch();
  const processed = await worker.processBatch();
  const policyJudgeShadow = await policyJudge.runBatch().catch(() => ({
    status: "ERROR",
    reason: "POLICY_JUDGE_WORKER_FAILED",
    publicationChanged: false,
  }));
  return { dispatched, processed, policyJudgeShadow };
}

async function main() {
  const command = process.argv[2] ?? "once";
  if (command === "diagnose-policy-judge") {
    console.log(JSON.stringify(judgeDiagnostic(judgeConfig, providerConfig), null, 2));
    return;
  }
  if (command === "policy-judge-summary") {
    console.log(JSON.stringify(await policyJudge.summary(), null, 2));
    return;
  }
  if (command === "policy-judge-once") {
    console.log(JSON.stringify(await policyJudge.runBatch(), null, 2));
    return;
  }
  if (command === "diagnose-publication") {
    const submissionId = z.uuid().parse(process.argv[3]);
    console.log(
      JSON.stringify(
        await readLatestPublicationReadiness(
          database.db,
          submissionId,
          new Date(),
          publicationEvidence,
        ),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "diagnose-provider") {
    console.log(JSON.stringify(providerRuntimeDiagnostic(providerConfig), null, 2));
    return;
  }
  if (command === "once") {
    console.log(JSON.stringify(await once(), null, 2));
    return;
  }
  if (command === "run") {
    while (true) {
      console.log(JSON.stringify(await once()));
      await wait(config.MODERATION_WORKER_POLL_MS);
    }
  }
  if (command === "dead-letters") {
    console.log(
      JSON.stringify(await worker.listDeadLetters(Number(process.argv[3]) || 50), null, 2),
    );
    return;
  }
  if (command === "requeue") {
    const runId = process.argv[3];
    if (!runId) throw new Error("Usage: moderation-worker requeue <run-id>");
    console.log(JSON.stringify(await worker.requeueDeadLetter(runId), null, 2));
    return;
  }
  if (command === "reconcile-media") {
    const storageConfig = issueMediaStorageConfig();
    if (!storageConfig) throw new Error("Issue media R2 configuration is incomplete.");
    const storage = createR2IssueMediaStorage(storageConfig);
    console.log(JSON.stringify(await worker.reconcileMedia(storage), null, 2));
    return;
  }
  throw new Error(`Unknown Moderation Worker command: ${command}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => database.close());
