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
import { createIssueMediaService } from "./modules/issue-media/service.js";
import { createIssueMediaReviewService } from "./modules/issue-media/review-service.js";
import {
  createR2IssueMediaStorage,
  issueMediaStorageConfig,
} from "./modules/issue-media/storage.js";
import { createPointIntegrityService } from "./modules/points/integrity.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const config = getConfig();
const database = createDatabase(config.databaseUrl);
const mediaStorageConfig = issueMediaStorageConfig();
const issueMediaStorage = mediaStorageConfig ? createR2IssueMediaStorage(mediaStorageConfig) : null;
const issueMediaService = issueMediaStorage
  ? createIssueMediaService(database.db, issueMediaStorage)
  : null;
const app = await buildApp(config, {
  ...database,
  issueReader: createIssueReadService(database.db, {
    personalizationEnabled: config.featureFlags.mlRanker,
  }),
  ...(config.environment !== "production" || config.featureFlags.creatorSubmissions
    ? { issueWriter: createIssueWriteService(database.db) }
    : {}),
  guestVotes: createGuestVoteService(database.db),
  commentReader: createCommentService(database.db),
  memberIdentity: createMemberIdentityService(database.db, {
    sessionTtlSeconds: config.auth.memberSessionTtlSeconds,
    allowDevelopmentProvider: config.auth.allowDevelopmentProvider,
    requireVerifiedEmail: config.auth.requireVerifiedEmail,
    authSecurity: config.auth.security,
  }),
  interestProfiles: createInterestProfileService(database.db),
  analytics: createAnalyticsService(database.db),
  shareCards: createShareCardService(database.db, {
    enabled: config.featureFlags.resultSharing,
  }),
  opsDashboard: createOpsDashboardService(database.db, { releaseId: config.releaseId }),
  ...(issueMediaStorage && issueMediaService
    ? {
        issueMedia: issueMediaService,
        issueMediaReview: createIssueMediaReviewService(
          database.db,
          issueMediaStorage,
          issueMediaService,
        ),
      }
    : {}),
  pointIntegrity: createPointIntegrityService(database.db, {
    targetEnvironment: config.environment,
  }),
});

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
