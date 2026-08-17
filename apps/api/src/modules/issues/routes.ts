import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { IssueReadService } from "./contracts.js";
import { IssueReadError } from "./errors.js";

const uuidSchema = Type.String({ format: "uuid" });

const errorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
});

const tallySchema = Type.Object({
  resultVersion: Type.Integer({ minimum: 1 }),
  acceptedA: Type.Integer({ minimum: 0 }),
  acceptedB: Type.Integer({ minimum: 0 }),
  displayedTotal: Type.Integer({ minimum: 0 }),
  integrityState: Type.Union([
    Type.Literal("NORMAL"),
    Type.Literal("MONITORING"),
    Type.Literal("DEGRADED"),
    Type.Literal("UNDER_REVIEW"),
    Type.Literal("RESULT_LOCKED"),
    Type.Literal("CORRECTED"),
  ]),
});

const issueResponseSchema = Type.Object({
  id: uuidSchema,
  version: Type.Integer({ minimum: 1 }),
  question: Type.String(),
  context: Type.Union([Type.String(), Type.Null()]),
  publishedAt: Type.String({ format: "date-time" }),
  categoryCode: Type.String(),
  experienceModeCode: Type.String(),
  choices: Type.Array(
    Type.Object({
      id: uuidSchema,
      code: Type.Union([Type.Literal("A"), Type.Literal("B")]),
      label: Type.String(),
    }),
    { minItems: 2, maxItems: 2 },
  ),
  result: Type.Object({
    visibility: Type.Union([
      Type.Literal("PRE_VOTE_HIDDEN"),
      Type.Literal("RESULT_VISIBLE"),
      Type.Literal("RESULT_LOCKED"),
      Type.Literal("RESULT_DEGRADED"),
      Type.Literal("RESULT_UNAVAILABLE"),
    ]),
    tally: Type.Union([tallySchema, Type.Null()]),
  }),
});

type IssueRoute = {
  Params: { issueId: string };
};

export async function registerIssueRoutes(app: FastifyInstance, service: IssueReadService) {
  await app.register((issueApp) => {
    issueApp.setErrorHandler((error, request, reply) => {
      if (error instanceof IssueReadError) {
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
          message: "The Issue request does not match the API contract.",
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        code: "INTERNAL_ERROR",
        message: "The Issue could not be loaded.",
      });
    });

    issueApp.get<IssueRoute>(
      "/v1/issues/:issueId",
      {
        schema: {
          tags: ["issues"],
          summary: "Read the current Guest-available Issue Version",
          params: Type.Object({ issueId: uuidSchema }),
          response: {
            200: issueResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) => service.getGuestIssue(request.params.issueId),
    );
  });
}
