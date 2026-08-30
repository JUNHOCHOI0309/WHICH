import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";

import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { createCommentService } from "./modules/comments/service.js";
import { createIssueReadService } from "./modules/issues/service.js";
import { createIssueWriteService } from "./modules/issues/creation-service.js";
import { createMemberIdentityService } from "./modules/identity/service.js";
import { createInterestProfileService } from "./modules/interests/service.js";
import { createGuestVoteService } from "./modules/voting/service.js";
import { createAnalyticsService } from "./modules/analytics/service.js";
import { createShareCardService } from "./modules/shares/service.js";
import { createOpsDashboardService } from "./modules/operations/service.js";
import { createOpsModerationQueueService } from "./modules/operations/moderation-queue-service.js";
import { createIssueMediaService } from "./modules/issue-media/service.js";
import type { IssueMediaRuleGateMode } from "./modules/issue-media/upload-gate-policy.js";
import {
  createLocalMediaSignalDetector,
  localMediaScannerConfig,
} from "./modules/issue-media/local-scan-detector.js";
import { createIssueMediaUploadGateService } from "./modules/issue-media/upload-gate-service.js";
import { createIssueMediaReviewService } from "./modules/issue-media/review-service.js";
import {
  createR2IssueMediaStorage,
  issueMediaStorageConfig,
} from "./modules/issue-media/storage.js";
import { createPointIntegrityService } from "./modules/points/integrity.js";
import { createMemberPointService } from "./modules/points/member-service.js";
import { createPointShopService } from "./modules/point-shop/service.js";
import { createContentReportService } from "./modules/reports/service.js";
import { createContentRevisionService } from "./modules/content-revisions/service.js";
import { createMemberModerationService } from "./modules/member-moderation/service.js";
import {
  moderationProviderRuntimeConfig,
  providerRuntimeDiagnostic,
} from "./modules/moderation-providers/runtime-gate.js";
import { readModerationOperationalHealth } from "./modules/moderation-operations/operational-health.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const config = getConfig();
const database = createDatabase(config.databaseUrl);
const moderationProviderConfig = moderationProviderRuntimeConfig();
const moderationRuntimeDiagnostic = providerRuntimeDiagnostic(moderationProviderConfig);
const mediaStorageConfig = issueMediaStorageConfig();
const issueMediaStorage = mediaStorageConfig ? createR2IssueMediaStorage(mediaStorageConfig) : null;
const configuredIssueMediaRuleGateMode = process.env.ISSUE_MEDIA_RULE_GATE_MODE?.toUpperCase();
const issueMediaRuleGateMode: IssueMediaRuleGateMode = ["OFF", "SHADOW", "ENFORCE"].includes(
  configuredIssueMediaRuleGateMode ?? "",
)
  ? (configuredIssueMediaRuleGateMode as IssueMediaRuleGateMode)
  : "ENFORCE";
const issueMediaService = issueMediaStorage
  ? createIssueMediaService(database.db, issueMediaStorage, {
      ruleGateMode: issueMediaRuleGateMode,
      localSignalDetector: createLocalMediaSignalDetector({
        ...localMediaScannerConfig(),
        workerUrl: new URL(
          import.meta.url.endsWith(".ts") ? "./local-media-scanner.ts" : "./local-media-scanner.js",
          import.meta.url,
        ),
        ...(import.meta.url.endsWith(".ts") ? { execArgv: ["--import", "tsx"] } : {}),
      }),
    })
  : null;
const commentService = createCommentService(database.db);
const issueMediaReviewService =
  issueMediaStorage && issueMediaService
    ? createIssueMediaReviewService(database.db, issueMediaStorage, issueMediaService, {
        publishMemberSubmissions:
          config.environment !== "production" || config.featureFlags.creatorSubmissions,
      })
    : null;
const app = await buildApp(config, {
  ...database,
  issueReader: createIssueReadService(database.db, {
    personalizationEnabled: config.featureFlags.mlRanker,
    qualityRankerMode: config.featureFlags.qualityRankerMode,
    mediaExperiment: {
      enabled: config.featureFlags.issueMedia,
      exposurePercent: config.featureFlags.issueMediaExperimentPercent,
      ...(issueMediaStorage ? { publicUrl: (key) => issueMediaStorage.publicUrl(key) } : {}),
    },
  }),
  ...(config.environment !== "production" || config.featureFlags.creatorSubmissions
    ? { issueWriter: createIssueWriteService(database.db) }
    : {}),
  guestVotes: createGuestVoteService(database.db),
  commentReader: commentService,
  memberIdentity: createMemberIdentityService(database.db, {
    sessionTtlSeconds: config.auth.memberSessionTtlSeconds,
    mobileAuthTicketTtlSeconds: config.auth.mobileAuthTicketTtlSeconds,
    allowDevelopmentProvider: config.auth.allowDevelopmentProvider,
    requireVerifiedEmail: config.auth.requireVerifiedEmail,
    mediaConsentVersion: config.featureFlags.issueMediaConsentVersion,
    authSecurity: config.auth.security,
  }),
  interestProfiles: createInterestProfileService(database.db),
  analytics: createAnalyticsService(database.db),
  shareCards: createShareCardService(database.db, {
    enabled: config.featureFlags.resultSharing,
  }),
  opsDashboard: createOpsDashboardService(database.db, {
    releaseId: config.releaseId,
    qualityRankerMode: config.featureFlags.qualityRankerMode,
  }),
  ...(issueMediaStorage && issueMediaService && issueMediaReviewService
    ? {
        issueMedia: issueMediaService,
        issueMediaUploadGate: createIssueMediaUploadGateService(database.db, {
          mode: config.featureFlags.issueMemberMediaUploadMode,
          consentVersion: config.featureFlags.issueMediaConsentVersion,
          pseudonymSecret: config.auth.moderationInternalSecret,
          moderationCapacity: async () => ({
            allowed: (
              await readModerationOperationalHealth(database.db, moderationRuntimeDiagnostic)
            ).directUploadAllowed,
          }),
        }),
        issueMediaReview: issueMediaReviewService,
        opsModerationQueue: createOpsModerationQueueService(
          database.db,
          issueMediaReviewService,
          commentService,
          moderationRuntimeDiagnostic,
        ),
      }
    : {}),
  pointIntegrity: createPointIntegrityService(database.db, {
    targetEnvironment: config.environment,
  }),
  memberPoints: createMemberPointService(database.db),
  pointShop: createPointShopService(database.db),
  contentReports: createContentReportService(database.db),
  contentRevisions: createContentRevisionService(database.db),
  memberModeration: createMemberModerationService(database.db, {
    ...(issueMediaStorage ? { publicUrl: (key) => issueMediaStorage.publicUrl(key) } : {}),
  }),
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
