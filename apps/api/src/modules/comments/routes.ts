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
  threadState: Type.Union([Type.Literal("OPEN"), Type.Literal("LOCKED")]),
  createdAt: Type.String({ format: "date-time" }),
  editedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  reactions: Type.Object({
    helpfulCount: Type.Integer({ minimum: 0 }),
    viewerReacted: Type.Boolean(),
  }),
});

const commentPageSchema = Type.Object({
  items: Type.Array(publicCommentSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});

type CommentRoute = {
  Params: { issueId: string };
  Querystring: { side?: "ALL" | "A" | "B"; cursor?: string; limit?: number };
  Headers: { authorization?: string; "x-anonymous-subject-id"?: string };
};

type CommentWriteRoute = {
  Params: { issueId: string };
  Headers: { authorization?: string; "idempotency-key": string };
  Body: { body: string };
};

type HelpfulReactionRoute = {
  Params: { commentId: string };
  Headers: {
    authorization?: string;
    "x-anonymous-subject-id"?: string;
    "idempotency-key": string;
  };
};

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function registerCommentRoutes(app: FastifyInstance, service: CommentService) {
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
  });
}
