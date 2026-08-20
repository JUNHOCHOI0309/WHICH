import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";

import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { createCommentService } from "./modules/comments/service.js";
import { createIssueReadService } from "./modules/issues/service.js";
import { createMemberIdentityService } from "./modules/identity/service.js";
import { createInterestProfileService } from "./modules/interests/service.js";
import { createGuestVoteService } from "./modules/voting/service.js";
import { createAnalyticsService } from "./modules/analytics/service.js";
import { createShareCardService } from "./modules/shares/service.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const config = getConfig();
const database = createDatabase(config.databaseUrl);
const app = await buildApp(config, {
  ...database,
  issueReader: createIssueReadService(database.db, {
    personalizationEnabled: config.featureFlags.mlRanker,
  }),
  guestVotes: createGuestVoteService(database.db),
  commentReader: createCommentService(database.db),
  memberIdentity: createMemberIdentityService(database.db, {
    sessionTtlSeconds: config.auth.memberSessionTtlSeconds,
    allowDevelopmentProvider: config.auth.allowDevelopmentProvider,
  }),
  interestProfiles: createInterestProfileService(database.db),
  analytics: createAnalyticsService(database.db),
  shareCards: createShareCardService(database.db, {
    enabled: config.featureFlags.resultSharing,
  }),
});

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
