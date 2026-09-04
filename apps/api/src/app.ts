import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import type { Database } from "./database/client.js";
import { databaseConnectionFailure } from "./database/connection-failure.js";
import type { CommentService } from "./modules/comments/contracts.js";
import { registerCommentRoutes } from "./modules/comments/routes.js";
import type { IssueReadService, IssueWriteService } from "./modules/issues/contracts.js";
import { registerIssueRoutes } from "./modules/issues/routes.js";
import type { MemberIdentityService } from "./modules/identity/contracts.js";
import { registerMemberIdentityRoutes } from "./modules/identity/routes.js";
import type { InterestProfileService } from "./modules/interests/contracts.js";
import { registerInterestRoutes } from "./modules/interests/routes.js";
import type { GuestVoteService } from "./modules/voting/contracts.js";
import { registerVotingRoutes } from "./modules/voting/routes.js";
import type { AnalyticsService } from "./modules/analytics/contracts.js";
import { registerAnalyticsRoutes } from "./modules/analytics/routes.js";
import type { ShareCardService } from "./modules/shares/contracts.js";
import { registerShareCardRoutes } from "./modules/shares/routes.js";
import type { OpsDashboardService } from "./modules/operations/contracts.js";
import { registerOpsRoutes } from "./modules/operations/routes.js";
import type { OpsModerationQueueService } from "./modules/operations/moderation-queue-contracts.js";
import { registerOpsModerationQueueRoutes } from "./modules/operations/moderation-queue-routes.js";
import type { IssueMediaService } from "./modules/issue-media/contracts.js";
import { registerIssueMediaRoutes } from "./modules/issue-media/routes.js";
import type { IssueMediaUploadGateService } from "./modules/issue-media/upload-gate-service.js";
import type { IssueMediaReviewService } from "./modules/issue-media/review-contracts.js";
import { registerIssueMediaReviewRoutes } from "./modules/issue-media/review-routes.js";
import type { PointIntegrityService } from "./modules/points/integrity.js";
import { registerPointOpsRoutes } from "./modules/points/ops-routes.js";
import type { MemberPointService } from "./modules/points/member-contracts.js";
import { registerMemberPointRoutes } from "./modules/points/member-routes.js";
import type { PointShopService } from "./modules/point-shop/contracts.js";
import { registerPointShopMemberRoutes } from "./modules/point-shop/member-routes.js";
import type { ContentReportService } from "./modules/reports/contracts.js";
import { registerContentReportRoutes } from "./modules/reports/routes.js";
import type { ContentRevisionService } from "./modules/content-revisions/contracts.js";
import { registerContentRevisionRoutes } from "./modules/content-revisions/routes.js";
import type { MemberModerationService } from "./modules/member-moderation/contracts.js";
import { registerMemberModerationRoutes } from "./modules/member-moderation/routes.js";
import type { IssueRecommendationService } from "./modules/issue-recommendations/contracts.js";
import { registerIssueRecommendationRoutes } from "./modules/issue-recommendations/routes.js";

export type AppDependencies = Pick<Database, "ping" | "close"> & {
  connectionDiagnostics?: Database["connectionDiagnostics"];
  issueReader: IssueReadService;
  issueWriter?: IssueWriteService;
  guestVotes: GuestVoteService;
  commentReader: CommentService;
  memberIdentity: MemberIdentityService;
  interestProfiles?: InterestProfileService;
  analytics?: AnalyticsService;
  shareCards?: ShareCardService;
  opsDashboard?: OpsDashboardService;
  opsModerationQueue?: OpsModerationQueueService;
  issueMedia?: IssueMediaService;
  issueMediaUploadGate?: IssueMediaUploadGateService;
  issueMediaReview?: IssueMediaReviewService;
  pointIntegrity?: PointIntegrityService;
  memberPoints?: MemberPointService;
  pointShop?: PointShopService;
  contentReports?: ContentReportService;
  contentRevisions?: ContentRevisionService;
  memberModeration?: MemberModerationService;
  issueRecommendations?: IssueRecommendationService;
};

const statusSchema = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("unavailable")]),
  service: Type.Literal("which-api"),
});

export async function buildApp(config: AppConfig, database: AppDependencies) {
  const app = Fastify({
    logger:
      config.environment === "test"
        ? false
        : {
            level: config.server.logLevel,
            transport:
              config.environment === "development"
                ? { target: "pino-pretty", options: { colorize: true } }
                : undefined,
          },
  });

  app.addHook("onError", async (request, _reply, error) => {
    const failure = databaseConnectionFailure(error);
    if (failure) {
      request.log.warn(
        {
          event: "DATABASE_CONNECTION_TIMEOUT",
          failure,
          route: request.routeOptions.url,
          method: request.method,
          pool: database.connectionDiagnostics?.(),
        },
        "Database connection acquisition timed out",
      );
    }
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: config.server.webOrigin,
    credentials: true,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "WHICH API",
        description: "WHICH platform API contract",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get(
    "/health/live",
    {
      schema: {
        tags: ["system"],
        response: { 200: statusSchema },
      },
    },
    () => ({ status: "ok" as const, service: "which-api" as const }),
  );

  app.get(
    "/health/ready",
    {
      schema: {
        tags: ["system"],
        response: { 200: statusSchema, 503: statusSchema },
      },
    },
    async (_request, reply) => {
      try {
        await database.ping();
        return { status: "ok" as const, service: "which-api" as const };
      } catch {
        return reply
          .code(503)
          .send({ status: "unavailable" as const, service: "which-api" as const });
      }
    },
  );

  app.get("/v1/meta", { schema: { tags: ["system"] } }, () => ({
    service: "which-api",
    version: "0.1.0",
    releaseId: config.releaseId,
    featureFlags: config.featureFlags,
  }));

  await registerIssueRoutes(app, database.issueReader, database.issueWriter);
  await registerVotingRoutes(app, database.guestVotes, config.auth.internalSecret);
  await registerCommentRoutes(app, database.commentReader, config.auth.moderationInternalSecret);
  await registerMemberIdentityRoutes(app, database.memberIdentity, config.auth.internalSecret);
  if (database.issueRecommendations) {
    await registerIssueRecommendationRoutes(app, database.issueRecommendations);
  }
  if (database.contentReports) {
    await registerContentReportRoutes(app, database.contentReports);
  }
  if (database.contentRevisions) {
    registerContentRevisionRoutes(
      app,
      database.contentRevisions,
      config.auth.moderationInternalSecret,
    );
  }
  if (database.memberModeration) {
    await registerMemberModerationRoutes(app, database.memberModeration, database.memberIdentity);
  }
  if (database.memberPoints) {
    registerMemberPointRoutes(app, database.memberPoints, database.memberIdentity);
  }
  if (database.pointShop) {
    await registerPointShopMemberRoutes(app, database.pointShop, database.memberIdentity);
  }
  if (database.interestProfiles) {
    await registerInterestRoutes(app, database.interestProfiles);
  }
  if (database.analytics) {
    await registerAnalyticsRoutes(app, database.analytics, config.auth.internalSecret);
  }
  if (database.shareCards) {
    await registerShareCardRoutes(app, database.shareCards, config.auth.internalSecret);
  }
  if (database.opsDashboard) {
    await registerOpsRoutes(
      app,
      database.opsDashboard,
      database.memberIdentity,
      config.auth.internalSecret,
    );
  }
  if (database.opsModerationQueue) {
    await registerOpsModerationQueueRoutes(
      app,
      database.opsModerationQueue,
      database.memberIdentity,
      config.auth.internalSecret,
    );
  }
  if (database.issueMedia) {
    await registerIssueMediaRoutes(
      app,
      database.issueMedia,
      database.memberIdentity,
      config.auth.internalSecret,
      database.issueMediaUploadGate,
    );
  }
  if (database.issueMediaReview) {
    await registerIssueMediaReviewRoutes(
      app,
      database.issueMediaReview,
      database.memberIdentity,
      config.auth.internalSecret,
    );
  }
  if (database.pointIntegrity) {
    await registerPointOpsRoutes(
      app,
      database.pointIntegrity,
      database.memberIdentity,
      config.auth.internalSecret,
    );
  }

  app.addHook("onClose", async () => {
    await database.close();
  });

  return app;
}
