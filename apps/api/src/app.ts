import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import type { Database } from "./database/client.js";
import type { CommentReadService } from "./modules/comments/contracts.js";
import { registerCommentRoutes } from "./modules/comments/routes.js";
import type { IssueReadService } from "./modules/issues/contracts.js";
import { registerIssueRoutes } from "./modules/issues/routes.js";
import type { GuestVoteService } from "./modules/voting/contracts.js";
import { registerVotingRoutes } from "./modules/voting/routes.js";

export type AppDependencies = Pick<Database, "ping" | "close"> & {
  issueReader: IssueReadService;
  guestVotes: GuestVoteService;
  commentReader: CommentReadService;
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
    featureFlags: config.featureFlags,
  }));

  await registerIssueRoutes(app, database.issueReader);
  await registerVotingRoutes(app, database.guestVotes);
  await registerCommentRoutes(app, database.commentReader);

  app.addHook("onClose", async () => {
    await database.close();
  });

  return app;
}
