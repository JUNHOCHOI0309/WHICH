import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import {
  CONTENT_REPORT_REASONS,
  CONTENT_REPORT_TARGETS,
  type ContentReportService,
} from "./contracts.js";
import { ContentReportError } from "./service.js";

const uuid = Type.String({ format: "uuid" });

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function registerContentReportRoutes(
  app: FastifyInstance,
  service: ContentReportService,
) {
  await app.register((reportApp) => {
    reportApp.setErrorHandler((error, request, reply) => {
      if (error instanceof ContentReportError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        error.validation
      ) {
        return reply.code(400).send({
          code: "INVALID_REQUEST",
          message: "The content report request does not match the contract.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "CONTENT_REPORT_FAILED",
        message: "The content report could not be recorded.",
      });
    });

    reportApp.post<{
      Headers: {
        authorization?: string;
        "x-anonymous-subject-id"?: string;
        "idempotency-key": string;
      };
      Body: {
        targetType: (typeof CONTENT_REPORT_TARGETS)[number];
        targetId: string;
        reasonCode: (typeof CONTENT_REPORT_REASONS)[number];
        detail?: string;
      };
    }>(
      "/v1/reports",
      {
        schema: {
          tags: ["reports"],
          summary: "Report one public Issue or Issue media asset",
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-anonymous-subject-id": Type.Optional(uuid),
              "idempotency-key": uuid,
            },
            { additionalProperties: true },
          ),
          body: Type.Object(
            {
              targetType: Type.Union(CONTENT_REPORT_TARGETS.map((value) => Type.Literal(value))),
              targetId: uuid,
              reasonCode: Type.Union(CONTENT_REPORT_REASONS.map((value) => Type.Literal(value))),
              detail: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const sessionToken = bearerToken(request.headers.authorization);
        if (request.headers.authorization && !sessionToken) {
          throw new ContentReportError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }
        const result = await service.report({
          ...request.body,
          sessionToken: sessionToken ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          idempotencyKey: request.headers["idempotency-key"],
        });
        return reply.code(result.httpStatus).send(result.body);
      },
    );
  });
}
