import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import { SHARE_CHANNELS, type ShareCardService } from "./contracts.js";
import { ShareCardError } from "./errors.js";

const uuidSchema = Type.String({ format: "uuid" });
const errorSchema = Type.Object({ code: Type.String(), message: Type.String() });
const shareCardSchema = Type.Object({
  id: uuidSchema,
  version: Type.Literal("result_share_v1"),
  channel: Type.Union(SHARE_CHANNELS.map((channel) => Type.Literal(channel))),
  shareType: Type.Union([Type.Literal("RESULT"), Type.Literal("RESULT_WITH_CHOICE")]),
  sharedChoiceCode: Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  issue: Type.Object({
    id: uuidSchema,
    version: Type.Integer({ minimum: 1 }),
    question: Type.String(),
    choices: Type.Array(
      Type.Object({
        code: Type.Union([Type.Literal("A"), Type.Literal("B")]),
        label: Type.String(),
      }),
      { minItems: 2, maxItems: 2 },
    ),
  }),
  result: Type.Object({
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
  }),
});

function secretMatches(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export async function registerShareCardRoutes(
  app: FastifyInstance,
  service: ShareCardService,
  internalSecret: string,
) {
  await app.register((shareApp) => {
    shareApp.setErrorHandler((error, request, reply) => {
      if (error instanceof ShareCardError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        error.validation
      ) {
        return reply
          .code(400)
          .send({ code: "INVALID_REQUEST", message: "The Share request is invalid." });
      }
      request.log.error(error);
      return reply.code(500).send({ code: "INTERNAL_ERROR", message: "The Share request failed." });
    });

    shareApp.post<{
      Params: { issueId: string };
      Headers: { "x-internal-auth-secret"?: string };
      Body: {
        issueVersion: number;
        resultVersion: number;
        channel: (typeof SHARE_CHANNELS)[number];
        sharedChoiceCode?: "A" | "B";
      };
    }>(
      "/v1/internal/issues/:issueId/share-cards",
      {
        schema: {
          hide: true,
          params: Type.Object({ issueId: uuidSchema }),
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            issueVersion: Type.Integer({ minimum: 1 }),
            resultVersion: Type.Integer({ minimum: 1 }),
            channel: Type.Union(SHARE_CHANNELS.map((channel) => Type.Literal(channel))),
            sharedChoiceCode: Type.Optional(Type.Union([Type.Literal("A"), Type.Literal("B")])),
          }),
          response: {
            201: shareCardSchema,
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            409: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request, reply) => {
        if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
          return reply
            .code(401)
            .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        }
        return reply.code(201).send(
          await service.createShareCard({
            issueId: request.params.issueId,
            ...request.body,
          }),
        );
      },
    );

    shareApp.get<{ Params: { shareCardId: string } }>(
      "/v1/share-cards/:shareCardId",
      {
        schema: {
          tags: ["shares"],
          summary: "Read a public non-identifying Result Share Snapshot",
          params: Type.Object({ shareCardId: uuidSchema }),
          response: {
            200: shareCardSchema,
            400: errorSchema,
            404: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request) => service.getShareCard(request.params.shareCardId),
    );

    shareApp.post<{
      Params: { shareCardId: string };
      Headers: { authorization?: string; "idempotency-key"?: string };
    }>(
      "/v1/share-cards/:shareCardId/reward-claims",
      {
        schema: {
          tags: ["shares"],
          summary: "Confirm a successful Member share as a reward Domain Fact",
          params: Type.Object({ shareCardId: uuidSchema }),
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "idempotency-key": Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
            },
            { additionalProperties: true },
          ),
          response: {
            200: Type.Object({ claimed: Type.Boolean() }),
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request) => {
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length).trim()
          : "";
        const idempotencyKey = request.headers["idempotency-key"] ?? "";
        if (!token || !idempotencyKey) {
          throw new ShareCardError("SESSION_INVALID", 401, "A valid Member session is required.");
        }
        return service.confirmRewardClaim({
          shareCardId: request.params.shareCardId,
          sessionToken: token,
          idempotencyKey,
        });
      },
    );
  });
}
