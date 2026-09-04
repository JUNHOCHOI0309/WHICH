import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { IssueRecommendationService } from "./contracts.js";
import { IssueRecommendationError } from "./service.js";

const uuidSchema = Type.String({ format: "uuid" });

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export async function registerIssueRecommendationRoutes(
  app: FastifyInstance,
  service: IssueRecommendationService,
) {
  await app.register((recommendationApp) => {
    recommendationApp.setErrorHandler((error, request, reply) => {
      if (error instanceof IssueRecommendationError) {
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
          message: "추천 요청 형식을 확인해 주세요.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "ISSUE_RECOMMENDATION_FAILED",
        message: "추천 상태를 저장하지 못했습니다.",
      });
    });

    recommendationApp.put<{
      Params: { issueId: string };
      Headers: { authorization?: string };
      Body: { active: boolean };
    }>(
      "/v1/issues/:issueId/recommendation",
      {
        schema: {
          tags: ["issues"],
          summary: "Set the current Member's recommendation for an Issue",
          params: Type.Object({ issueId: uuidSchema }),
          headers: Type.Object(
            { authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })) },
            { additionalProperties: true },
          ),
          body: Type.Object({ active: Type.Boolean() }),
          response: {
            200: Type.Object({
              recommendation: Type.Object({
                active: Type.Boolean(),
                count: Type.Integer({ minimum: 0 }),
              }),
            }),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            404: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request) => {
        const token = bearerToken(request.headers.authorization);
        if (!token) {
          throw new IssueRecommendationError(
            "SESSION_REQUIRED",
            401,
            "질문을 추천하려면 Member 로그인이 필요합니다.",
          );
        }
        return service.set({
          issueId: request.params.issueId,
          sessionToken: token,
          active: request.body.active,
        });
      },
    );
  });
}
