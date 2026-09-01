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
  acceptedC: Type.Optional(Type.Integer({ minimum: 0 })),
  acceptedD: Type.Optional(Type.Integer({ minimum: 0 })),
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
  code: Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Literal("C"), Type.Literal("D")]),
  label: Type.String(),
  media: Type.Union([
    Type.Object({
      url: Type.String({ format: "uri" }),
      altText: Type.String({ minLength: 1 }),
      cropMode: Type.Union([Type.Literal("COVER"), Type.Literal("CONTAIN")]),
      width: Type.Integer({ minimum: 1 }),
      height: Type.Integer({ minimum: 1 }),
    }),
    Type.Null(),
  ]),
});

const issueResponseSchema = Type.Object({
  id: uuidSchema,
  version: Type.Integer({ minimum: 1 }),
  question: Type.String(),
  context: Type.Union([Type.String(), Type.Null()]),
  contextMedia: Type.Optional(Type.Union([choiceSchema.properties.media, Type.Null()])),
  publishedAt: Type.String({ format: "date-time" }),
  categoryCode: Type.String(),
  experienceModeCode: Type.String(),
  mediaMode: Type.Union([Type.Literal("TEXT_ONLY"), Type.Literal("OPTION_IMAGES")]),
  choices: Type.Array(choiceSchema, { minItems: 2, maxItems: 4 }),
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
      mediaMode: Type.Union([Type.Literal("TEXT_ONLY"), Type.Literal("OPTION_IMAGES")]),
      choices: Type.Array(choiceSchema, { minItems: 2, maxItems: 4 }),
      recommendation: Type.Object({
        requestId: uuidSchema,
        score: Type.Integer({ minimum: 0 }),
        reasonCodes: Type.Array(
          Type.Union([
            Type.Literal("INTEREST_MATCH"),
            Type.Literal("DEFAULT_TOPIC_BOOST"),
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
    version: Type.Literal("quality_feed_v1"),
    mode: Type.Union([Type.Literal("PERSONALIZED"), Type.Literal("RECENCY")]),
    reasonCode: Type.Union([
      Type.Literal("INTEREST_PROFILE_MATCH"),
      Type.Literal("PROFILE_NOT_READY"),
      Type.Literal("FEATURE_DISABLED"),
      Type.Literal("IDENTITY_UNAVAILABLE"),
      Type.Literal("RANKER_FALLBACK"),
    ]),
    profileVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    policyVersion: Type.Literal("quality-feed-v1.0"),
    qualityMode: Type.Union([Type.Literal("OFF"), Type.Literal("SHADOW"), Type.Literal("LIVE")]),
    fallbackReason: Type.Union([Type.String(), Type.Null()]),
  }),
  rightRail: Type.Object({
    version: Type.Literal("participation_v1"),
    items: Type.Array(
      Type.Object({
        issueId: uuidSchema,
        question: Type.String(),
        categoryCode: Type.String(),
        participationCount: Type.Integer({ minimum: 0 }),
        reasonCode: Type.Union([
          Type.Literal("RECENT_PARTICIPATION"),
          Type.Literal("RECENT_FALLBACK"),
        ]),
      }),
      { maxItems: 3 },
    ),
  }),
});

const publicIssueCatalogResponseSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: uuidSchema,
      version: Type.Integer({ minimum: 1 }),
      question: Type.String(),
      context: Type.Union([Type.String(), Type.Null()]),
      contextMedia: Type.Optional(Type.Union([choiceSchema.properties.media, Type.Null()])),
      publishedAt: Type.String({ format: "date-time" }),
      categoryCode: Type.String(),
      choices: Type.Array(choiceSchema, { minItems: 2, maxItems: 4 }),
    }),
    { maxItems: 500 },
  ),
});

type IssueRoute = {
  Params: { issueId: string };
  Headers: { "x-anonymous-subject-id"?: string; authorization?: string };
};

type IssueFeedRoute = {
  Querystring: { cursor?: string; limit?: number; excludeIssueId?: string };
  Headers: { "x-anonymous-subject-id"?: string; authorization?: string };
};

type PublicIssueCatalogRoute = {
  Querystring: { limit?: number };
};

type IssueCreateRoute = {
  Headers: { authorization?: string; "idempotency-key": string };
  Body: {
    question: string;
    context?: string | null;
    choiceA: string;
    choiceB: string;
    choiceC?: string | null;
    choiceD?: string | null;
    contextMediaAssetId?: string | null;
    mediaAssetAId?: string | null;
    mediaAssetBId?: string | null;
    mediaAssetCId?: string | null;
    mediaAssetDId?: string | null;
    libraryPairId?: string | null;
    libraryAssetIds?: string[] | null;
    interestCardCode: (typeof INTEREST_CARD_CODES)[number];
  };
};

type MemberIssueSubmissionListRoute = {
  Querystring: { limit?: number; submissionId?: string };
  Headers: { authorization?: string };
};

type MemberIssueResubmitRoute = IssueCreateRoute & {
  Params: { submissionId: string };
  Body: IssueCreateRoute["Body"] & { expectedRevision: number };
};

const memberIssueSubmissionSchema = Type.Object({
  id: uuidSchema,
  revision: Type.Integer({ minimum: 1 }),
  status: Type.Union([
    Type.Literal("PENDING"),
    Type.Literal("APPROVED"),
    Type.Literal("NEEDS_CHANGES"),
    Type.Literal("REJECTED"),
    Type.Literal("CANCELLED"),
  ]),
  publishedIssueId: Type.Union([uuidSchema, Type.Null()]),
  publicationState: Type.Union(
    ["PROCESSING", "PUBLISHED", "NEEDS_CHANGES", "REJECTED", "QUARANTINED", "CANCELLED"].map(
      (value) => Type.Literal(value),
    ),
  ),
  question: Type.String(),
  context: Type.Union([Type.String(), Type.Null()]),
  choiceA: Type.String(),
  choiceB: Type.String(),
  choiceC: Type.Union([Type.String(), Type.Null()]),
  choiceD: Type.Union([Type.String(), Type.Null()]),
  contextMediaAssetId: Type.Union([uuidSchema, Type.Null()]),
  mediaAssetAId: Type.Union([uuidSchema, Type.Null()]),
  mediaAssetBId: Type.Union([uuidSchema, Type.Null()]),
  mediaAssetCId: Type.Union([uuidSchema, Type.Null()]),
  mediaAssetDId: Type.Union([uuidSchema, Type.Null()]),
  interestCardCode: Type.Union(INTEREST_CARD_CODES.map((code) => Type.Literal(code))),
  reviewNote: Type.Union([Type.String(), Type.Null()]),
  submittedAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});

const memberIssueSubmissionBodySchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 200 }),
  context: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  choiceA: Type.String({ minLength: 1, maxLength: 100 }),
  choiceB: Type.String({ minLength: 1, maxLength: 100 }),
  choiceC: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])),
  choiceD: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()])),
  contextMediaAssetId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  mediaAssetAId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  mediaAssetBId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  mediaAssetCId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  mediaAssetDId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
  interestCardCode: Type.Union(INTEREST_CARD_CODES.map((code) => Type.Literal(code))),
});

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
      issueApp.post<{
        Headers: { authorization?: string };
        Params: { submissionId: string };
        Body: {
          expectedRevision: number;
          action: "TEXT_ONLY" | "LIBRARY" | "CANCEL" | "DELETE" | "CHECK";
          libraryPairId?: string;
          libraryAssetIds?: string[];
        };
      }>(
        "/v1/member/issue-submissions/:submissionId/actions",
        {
          schema: {
            params: Type.Object({ submissionId: uuidSchema }),
            body: Type.Object(
              {
                expectedRevision: Type.Integer({ minimum: 1 }),
                action: Type.Union(
                  ["TEXT_ONLY", "LIBRARY", "CANCEL", "DELETE", "CHECK"].map((value) =>
                    Type.Literal(value),
                  ),
                ),
                libraryPairId: Type.Optional(uuidSchema),
                libraryAssetIds: Type.Optional(
                  Type.Array(uuidSchema, { minItems: 2, maxItems: 4, uniqueItems: true }),
                ),
              },
              { additionalProperties: false },
            ),
            response: {
              200: Type.Object({
                submission: memberIssueSubmissionSchema,
                created: Type.Boolean(),
                deleted: Type.Optional(Type.Boolean()),
              }),
              401: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
              422: errorResponseSchema,
              503: errorResponseSchema,
              500: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const token = bearerToken(request.headers.authorization);
          if (!token) throw new IssueWriteError("SESSION_REQUIRED", 401, "로그인이 필요해요.");
          return writer.actOnMemberIssueSubmission({
            sessionToken: token,
            submissionId: request.params.submissionId,
            ...request.body,
          });
        },
      );
      issueApp.post<IssueCreateRoute>(
        "/v1/member/issue-submissions",
        {
          schema: {
            tags: ["issues"],
            summary: "Submit one Member-authored A/B Issue for editorial review",
            headers: Type.Object(
              {
                authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })),
                "idempotency-key": uuidSchema,
              },
              { additionalProperties: true },
            ),
            body: memberIssueSubmissionBodySchema,
            response: {
              200: Type.Object({
                submission: memberIssueSubmissionSchema,
                created: Type.Boolean(),
              }),
              201: Type.Object({
                submission: memberIssueSubmissionSchema,
                created: Type.Boolean(),
              }),
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
              "질문을 제출하려면 활성 Member 로그인이 필요합니다.",
            );
          }
          const result = await writer.submitMemberIssue({
            sessionToken: token,
            idempotencyKey: request.headers["idempotency-key"],
            ...request.body,
          });
          return reply.code(result.created ? 201 : 200).send(result);
        },
      );

      issueApp.get<MemberIssueSubmissionListRoute>(
        "/v1/member/issue-submissions",
        {
          schema: {
            tags: ["issues"],
            summary: "List the current Member's editorial Issue submissions",
            headers: Type.Object(
              { authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })) },
              { additionalProperties: true },
            ),
            querystring: Type.Object({
              limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
              submissionId: Type.Optional(uuidSchema),
            }),
            response: {
              200: Type.Object({ items: Type.Array(memberIssueSubmissionSchema) }),
              401: errorResponseSchema,
              500: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const token = bearerToken(request.headers.authorization);
          if (!token) {
            throw new IssueWriteError(
              "SESSION_REQUIRED",
              401,
              "제출 상태를 확인하려면 로그인이 필요합니다.",
            );
          }
          return writer.listMemberIssueSubmissions({
            sessionToken: token,
            limit: request.query.limit ?? 10,
            submissionId: request.query.submissionId,
          });
        },
      );

      issueApp.put<MemberIssueResubmitRoute>(
        "/v1/member/issue-submissions/:submissionId",
        {
          schema: {
            tags: ["issues"],
            summary: "Submit a new revision after editorial changes were requested",
            params: Type.Object({ submissionId: uuidSchema }),
            headers: Type.Object(
              {
                authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })),
                "idempotency-key": uuidSchema,
              },
              { additionalProperties: true },
            ),
            body: Type.Intersect([
              memberIssueSubmissionBodySchema,
              Type.Object({ expectedRevision: Type.Integer({ minimum: 1 }) }),
            ]),
            response: {
              200: Type.Object({
                submission: memberIssueSubmissionSchema,
                created: Type.Boolean(),
              }),
              400: errorResponseSchema,
              401: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
              422: errorResponseSchema,
              500: errorResponseSchema,
            },
          },
        },
        async (request) => {
          const token = bearerToken(request.headers.authorization);
          if (!token) {
            throw new IssueWriteError(
              "SESSION_REQUIRED",
              401,
              "질문 수정본을 제출하려면 활성 Member 로그인이 필요합니다.",
            );
          }
          return writer.resubmitMemberIssue({
            sessionToken: token,
            submissionId: request.params.submissionId,
            idempotencyKey: request.headers["idempotency-key"],
            ...request.body,
          });
        },
      );

      issueApp.post<IssueCreateRoute>(
        "/v1/issues",
        {
          schema: {
            tags: ["issues"],
            summary: "Create and publish one safe Member-authored 2-4 choice Issue",
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
              choiceC: Type.Optional(
                Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
              ),
              choiceD: Type.Optional(
                Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
              ),
              libraryPairId: Type.Optional(Type.Union([uuidSchema, Type.Null()])),
              libraryAssetIds: Type.Optional(
                Type.Union([
                  Type.Array(uuidSchema, { minItems: 2, maxItems: 4, uniqueItems: true }),
                  Type.Null(),
                ]),
              ),
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

    issueApp.get<PublicIssueCatalogRoute>(
      "/v1/issues/catalog",
      {
        schema: {
          tags: ["issues"],
          summary: "List the newest public Issue versions for discovery without personalization",
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 500 })),
          }),
          response: {
            200: publicIssueCatalogResponseSchema,
            400: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) => service.listPublicIssueCatalog({ limit: request.query.limit ?? 500 }),
    );

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
          headers: Type.Object(
            {
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
              authorization: Type.Optional(Type.String({ minLength: 8, maxLength: 4096 })),
            },
            { additionalProperties: true },
          ),
          response: {
            200: issueResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) =>
        service.getGuestIssue(request.params.issueId, {
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          sessionToken: bearerToken(request.headers.authorization),
        }),
    );
  });
}
