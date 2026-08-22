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

const choiceSchema = Type.Object({
  id: uuidSchema,
  code: Type.Union([Type.Literal("A"), Type.Literal("B")]),
  label: Type.String(),
});

const issueResponseSchema = Type.Object({
  id: uuidSchema,
  version: Type.Integer({ minimum: 1 }),
  question: Type.String(),
  context: Type.Union([Type.String(), Type.Null()]),
  publishedAt: Type.String({ format: "date-time" }),
  categoryCode: Type.String(),
  experienceModeCode: Type.String(),
  choices: Type.Array(choiceSchema, { minItems: 2, maxItems: 2 }),
  author: Type.Union([
    Type.Object({
      displayName: Type.String(),
      handle: Type.String(),
      avatar: Type.Object({ kind: Type.Literal("INITIALS"), initials: Type.String() }),
    }),
    Type.Null(),
  ]),
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

const feedResponseSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: uuidSchema,
      version: Type.Integer({ minimum: 1 }),
      question: Type.String(),
      publishedAt: Type.String({ format: "date-time" }),
      categoryCode: Type.String(),
      choices: Type.Array(choiceSchema, { minItems: 2, maxItems: 2 }),
      recommendation: Type.Object({
        requestId: uuidSchema,
        score: Type.Integer({ minimum: 0 }),
        reasonCodes: Type.Array(
          Type.Union([
            Type.Literal("INTEREST_MATCH"),
            Type.Literal("EXPLORATION"),
            Type.Literal("RECENT_FALLBACK"),
          ]),
        ),
        matchedCardCodes: Type.Array(Type.String()),
      }),
    }),
  ),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  ranking: Type.Object({
    requestId: uuidSchema,
    version: Type.Literal("interest_content_v1"),
    mode: Type.Union([Type.Literal("PERSONALIZED"), Type.Literal("RECENCY")]),
    reasonCode: Type.Union([
      Type.Literal("INTEREST_PROFILE_MATCH"),
      Type.Literal("PROFILE_NOT_READY"),
      Type.Literal("FEATURE_DISABLED"),
      Type.Literal("IDENTITY_UNAVAILABLE"),
      Type.Literal("RANKER_FALLBACK"),
    ]),
    profileVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  }),
});

type IssueRoute = {
  Params: { issueId: string };
};

type IssueFeedRoute = {
  Querystring: { cursor?: string; limit?: number; excludeIssueId?: string };
  Headers: { "x-anonymous-subject-id"?: string; authorization?: string };
};

function bearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

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

    issueApp.get<IssueFeedRoute>(
      "/v1/issues/feed",
      {
        schema: {
          tags: ["issues"],
          summary: "List Guest-available Issues using a stable cursor",
          querystring: Type.Object({
            cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
            excludeIssueId: Type.Optional(uuidSchema),
          }),
          headers: Type.Object(
            {
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
              authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })),
            },
            { additionalProperties: true },
          ),
          response: {
            200: feedResponseSchema,
            400: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) =>
        service.listGuestIssues({
          cursor: request.query.cursor,
          limit: request.query.limit ?? 10,
          excludeIssueId: request.query.excludeIssueId,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          sessionToken: bearerToken(request.headers.authorization),
        }),
    );

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
