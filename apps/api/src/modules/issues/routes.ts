import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import { INTEREST_CARD_CODES } from "../interests/contracts.js";
import type { IssueReadService, IssueWriteService } from "./contracts.js";
import { IssueReadError, IssueWriteError } from "./errors.js";

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
      avatar: Type.Union([
        Type.Object({ kind: Type.Literal("INITIALS"), initials: Type.String() }),
        Type.Object({ kind: Type.Literal("IMAGE"), url: Type.String({ format: "uri" }) }),
      ]),
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

type IssueCreateRoute = {
  Headers: { authorization?: string; "idempotency-key": string };
  Body: {
    question: string;
    context?: string | null;
    choiceA: string;
    choiceB: string;
    interestCardCode: (typeof INTEREST_CARD_CODES)[number];
  };
};

function bearerToken(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export async function registerIssueRoutes(
  app: FastifyInstance,
  service: IssueReadService,
  writer?: IssueWriteService,
) {
  await app.register((issueApp) => {
    issueApp.setErrorHandler((error, request, reply) => {
      if (error instanceof IssueReadError || error instanceof IssueWriteError) {
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

    if (writer) {
      issueApp.post<IssueCreateRoute>(
        "/v1/issues",
        {
          schema: {
            tags: ["issues"],
            summary: "Create and publish one safe Member-authored A/B Issue",
            headers: Type.Object(
              {
                authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })),
                "idempotency-key": uuidSchema,
              },
              { additionalProperties: true },
            ),
            body: Type.Object({
              question: Type.String({ minLength: 1, maxLength: 200 }),
              context: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
              choiceA: Type.String({ minLength: 1, maxLength: 100 }),
              choiceB: Type.String({ minLength: 1, maxLength: 100 }),
              interestCardCode: Type.Union(INTEREST_CARD_CODES.map((code) => Type.Literal(code))),
            }),
            response: {
              200: Type.Object({ issue: issueResponseSchema, created: Type.Boolean() }),
              201: Type.Object({ issue: issueResponseSchema, created: Type.Boolean() }),
              400: errorResponseSchema,
              401: errorResponseSchema,
              409: errorResponseSchema,
              422: errorResponseSchema,
              429: errorResponseSchema,
              500: errorResponseSchema,
            },
          },
        },
        async (request, reply) => {
          const token = bearerToken(request.headers.authorization);
          if (!token) {
            throw new IssueWriteError(
              "SESSION_REQUIRED",
              401,
              "질문을 만들려면 활성 Member 로그인이 필요합니다.",
            );
          }
          const result = await writer.createMemberIssue({
            sessionToken: token,
            idempotencyKey: request.headers["idempotency-key"],
            ...request.body,
          });
          const issue = await service.getGuestIssue(result.issue.id);
          return reply.code(result.created ? 201 : 200).send({ issue, created: result.created });
        },
      );
    }

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
