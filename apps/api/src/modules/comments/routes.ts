import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { CommentService } from "./contracts.js";
import { CommentError } from "./errors.js";

const uuidSchema = Type.String({ format: "uuid" });
const errorResponseSchema = Type.Object({ code: Type.String(), message: Type.String() });

const publicCommentSchema = Type.Object({
  id: uuidSchema,
  choice: Type.Union([Type.Literal("A"), Type.Literal("B")]),
  author: Type.Object({ displayName: Type.String() }),
  body: Type.String(),
  visibility: Type.Union([
    Type.Literal("VISIBLE"),
    Type.Literal("DEPRIORITIZED"),
    Type.Literal("COLLAPSED"),
  ]),
  threadState: Type.Union([Type.Literal("OPEN"), Type.Literal("LOCKED")]),
  createdAt: Type.String({ format: "date-time" }),
  editedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  reactions: Type.Object({
    helpfulCount: Type.Integer({ minimum: 0 }),
    viewerReacted: Type.Boolean(),
  }),
  reports: Type.Object({
    viewerReported: Type.Boolean(),
    canReport: Type.Boolean(),
  }),
});

const commentPageSchema = Type.Object({
  items: Type.Array(publicCommentSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

const commentHighlightsSchema = Type.Object({
  A: Type.Array(publicCommentSchema),
  B: Type.Array(publicCommentSchema),
});

type CommentRoute = {
  Params: { issueId: string };
  Querystring: { side?: "ALL" | "A" | "B"; cursor?: string; limit?: number };
  Headers: { authorization?: string; "x-anonymous-subject-id"?: string };
};

type CommentWriteRoute = {
  Params: { issueId: string };
  Headers: {
    authorization?: string;
    "x-anonymous-subject-id"?: string;
    "idempotency-key": string;
  };
  Body: { body: string };
};

type CommentHighlightsRoute = {
  Params: { issueId: string };
  Querystring: { limitPerSide?: number };
  Headers: { authorization?: string; "x-anonymous-subject-id"?: string };
};

type HelpfulReactionRoute = {
  Params: { commentId: string };
  Headers: {
    authorization?: string;
    "x-anonymous-subject-id"?: string;
    "idempotency-key": string;
  };
};

type CommentReportRoute = {
  Params: { commentId: string };
  Headers: {
    authorization?: string;
    "x-anonymous-subject-id"?: string;
    "idempotency-key": string;
  };
  Body: {
    reason: "SPAM" | "HARASSMENT" | "HATE_OR_ABUSE" | "PERSONAL_INFORMATION" | "OTHER";
    detail?: string;
  };
};

type ModerationCasesRoute = {
  Querystring: { limit?: number };
  Headers: { "x-moderation-auth-secret"?: string };
};

type ModerationDecisionRoute = {
  Params: { commentId: string };
  Headers: { "x-moderation-auth-secret"?: string };
  Body: {
    action: "COLLAPSE" | "HIDE" | "REMOVE_POLICY" | "RESTORE";
    reasonCode: string;
  };
};

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function registerCommentRoutes(
  app: FastifyInstance,
  service: CommentService,
  moderationInternalSecret: string,
) {
  await app.register((commentApp) => {
    commentApp.setErrorHandler((error, request, reply) => {
      if (error instanceof CommentError) {
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
          message: "The Comment request does not match the API contract.",
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        code: "INTERNAL_ERROR",
        message: "Comments could not be loaded.",
      });
    });

    commentApp.get<CommentRoute>(
      "/v1/issues/:issueId/comments",
      {
        schema: {
          tags: ["comments"],
          summary: "List public Comments after an accepted Guest Vote",
          params: Type.Object({ issueId: uuidSchema }),
          querystring: Type.Object({
            side: Type.Optional(
              Type.Union([Type.Literal("ALL"), Type.Literal("A"), Type.Literal("B")], {
                default: "ALL",
              }),
            ),
            cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 10 })),
          }),
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
            },
            { additionalProperties: true },
          ),
          response: {
            200: commentPageSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const sessionToken = bearerToken(request.headers.authorization);
        if (request.headers.authorization && !sessionToken) {
          throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }
        return service.listGuestComments({
          issueId: request.params.issueId,
          sessionToken: sessionToken ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          side: request.query.side ?? "ALL",
          cursor: request.query.cursor,
          limit: request.query.limit ?? 10,
        });
      },
    );

    commentApp.get<CommentHighlightsRoute>(
      "/v1/issues/:issueId/comment-highlights",
      {
        schema: {
          tags: ["comments"],
          summary: "List representative A/B Comments after an accepted Vote",
          params: Type.Object({ issueId: uuidSchema }),
          querystring: Type.Object({
            limitPerSide: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, default: 5 })),
          }),
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
            },
            { additionalProperties: true },
          ),
          response: {
            200: commentHighlightsSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const sessionToken = bearerToken(request.headers.authorization);
        if (request.headers.authorization && !sessionToken) {
          throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }
        const limit = request.query.limitPerSide ?? 5;
        const query = {
          issueId: request.params.issueId,
          sessionToken: sessionToken ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          view: "HIGHLIGHT" as const,
          limit,
        };
        const [commentsA, commentsB] = await Promise.all([
          service.listGuestComments({ ...query, side: "A" }),
          service.listGuestComments({ ...query, side: "B" }),
        ]);
        return { A: commentsA.items, B: commentsB.items };
      },
    );

    commentApp.post<CommentWriteRoute>(
      "/v1/issues/:issueId/comments",
      {
        schema: {
          tags: ["comments"],
          summary: "Publish one eligible Member Comment for an Issue",
          params: Type.Object({ issueId: uuidSchema }),
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
              "idempotency-key": uuidSchema,
            },
            { additionalProperties: true },
          ),
          body: Type.Object({ body: Type.String({ minLength: 1, maxLength: 2_000 }) }),
          response: {
            201: Type.Object({ comment: publicCommentSchema }),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        if (!token) {
          throw new CommentError("SESSION_REQUIRED", 401, "An active Member session is required.");
        }
        const result = await service.submitMemberComment({
          issueId: request.params.issueId,
          sessionToken: token,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          idempotencyKey: request.headers["idempotency-key"],
          body: request.body.body,
        });
        return reply.code(result.httpStatus).send(result.body);
      },
    );

    commentApp.post<HelpfulReactionRoute>(
      "/v1/comments/:commentId/reactions/helpful",
      {
        schema: {
          tags: ["comments"],
          summary: "Toggle a HELPFUL reaction on a public Comment",
          params: Type.Object({ commentId: uuidSchema }),
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
              "idempotency-key": uuidSchema,
            },
            { additionalProperties: true },
          ),
          response: {
            200: Type.Object({
              reaction: Type.Object({
                code: Type.Literal("HELPFUL"),
                active: Type.Boolean(),
                helpfulCount: Type.Integer({ minimum: 0 }),
              }),
            }),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const sessionToken = bearerToken(request.headers.authorization);
        if (request.headers.authorization && !sessionToken) {
          throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }
        const result = await service.toggleHelpfulReaction({
          commentId: request.params.commentId,
          sessionToken: sessionToken ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          idempotencyKey: request.headers["idempotency-key"],
        });
        return reply.code(result.httpStatus).send(result.body);
      },
    );

    commentApp.post<CommentReportRoute>(
      "/v1/comments/:commentId/reports",
      {
        schema: {
          tags: ["comments"],
          summary: "Report a public Comment once as an eligible Guest or Member",
          params: Type.Object({ commentId: uuidSchema }),
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-anonymous-subject-id": Type.Optional(uuidSchema),
              "idempotency-key": uuidSchema,
            },
            { additionalProperties: true },
          ),
          body: Type.Object({
            reason: Type.Union([
              Type.Literal("SPAM"),
              Type.Literal("HARASSMENT"),
              Type.Literal("HATE_OR_ABUSE"),
              Type.Literal("PERSONAL_INFORMATION"),
              Type.Literal("OTHER"),
            ]),
            detail: Type.Optional(Type.String({ maxLength: 300 })),
          }),
          response: {
            201: Type.Object({
              report: Type.Object({
                accepted: Type.Literal(true),
                viewerReported: Type.Literal(true),
              }),
              comment: Type.Object({
                visibility: Type.Union([
                  Type.Literal("VISIBLE"),
                  Type.Literal("DEPRIORITIZED"),
                  Type.Literal("COLLAPSED"),
                  Type.Literal("HIDDEN"),
                ]),
              }),
            }),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
            429: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const sessionToken = bearerToken(request.headers.authorization);
        if (request.headers.authorization && !sessionToken) {
          throw new CommentError("SESSION_REQUIRED", 401, "The Member session is invalid.");
        }
        const result = await service.reportComment({
          commentId: request.params.commentId,
          sessionToken: sessionToken ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          idempotencyKey: request.headers["idempotency-key"],
          reason: request.body.reason,
          detail: request.body.detail,
        });
        return reply.code(result.httpStatus).send(result.body);
      },
    );

    commentApp.get<ModerationCasesRoute>(
      "/v1/internal/comment-moderation/cases",
      {
        schema: {
          tags: ["internal"],
          summary: "List Comments awaiting internal moderation",
          headers: Type.Object(
            { "x-moderation-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
          }),
          response: {
            200: Type.Object({ items: Type.Array(Type.Any()) }),
            401: errorResponseSchema,
          },
        },
      },
      async (request) => {
        if (request.headers["x-moderation-auth-secret"] !== moderationInternalSecret) {
          throw new CommentError(
            "MODERATION_AUTH_REQUIRED",
            401,
            "A valid moderation secret is required.",
          );
        }
        return service.listModerationCases(request.query.limit ?? 20);
      },
    );

    commentApp.post<ModerationDecisionRoute>(
      "/v1/internal/comments/:commentId/moderation-decisions",
      {
        schema: {
          tags: ["internal"],
          summary: "Apply an append-only internal Comment moderation decision",
          params: Type.Object({ commentId: uuidSchema }),
          headers: Type.Object(
            { "x-moderation-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            action: Type.Union([
              Type.Literal("COLLAPSE"),
              Type.Literal("HIDE"),
              Type.Literal("REMOVE_POLICY"),
              Type.Literal("RESTORE"),
            ]),
            reasonCode: Type.String({ minLength: 2, maxLength: 64, pattern: "^[A-Z0-9_]+$" }),
          }),
          response: {
            200: Type.Object({
              comment: Type.Object({
                id: uuidSchema,
                publicationState: Type.String(),
                visibility: Type.String(),
                integrityState: Type.String(),
              }),
            }),
            401: errorResponseSchema,
            404: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request) => {
        if (request.headers["x-moderation-auth-secret"] !== moderationInternalSecret) {
          throw new CommentError(
            "MODERATION_AUTH_REQUIRED",
            401,
            "A valid moderation secret is required.",
          );
        }
        return service.decideModeration({
          commentId: request.params.commentId,
          action: request.body.action,
          reasonCode: request.body.reasonCode,
        });
      },
    );
  });
}
