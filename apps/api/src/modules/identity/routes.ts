import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { MemberIdentityService } from "./contracts.js";
import { MemberIdentityError } from "./errors.js";

const memberSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  displayName: Type.String(),
  status: Type.Union([
    Type.Literal("ACTIVE"),
    Type.Literal("LIMITED"),
    Type.Literal("SUSPENDED"),
    Type.Literal("DELETED"),
  ]),
});

const errorSchema = Type.Object({ code: Type.String(), message: Type.String() });
const sessionViewSchema = Type.Object({
  expiresAt: Type.String({ format: "date-time" }),
  member: memberSchema,
});

function secretMatches(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function registerMemberIdentityRoutes(
  app: FastifyInstance,
  service: MemberIdentityService,
  internalSecret: string,
) {
  await app.register((identityApp) => {
    identityApp.setErrorHandler((error, request, reply) => {
      if (error instanceof MemberIdentityError) {
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
          message: "The member identity request does not match the API contract.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({ code: "INTERNAL_ERROR", message: "Member identity failed." });
    });

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: {
        provider: "GOOGLE" | "X" | "NAVER" | "DEVELOPMENT";
        providerSubject: string;
        displayName: string;
        anonymousSubjectId?: string;
      };
    }>(
      "/v1/internal/member-sessions",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            provider: Type.Union([
              Type.Literal("GOOGLE"),
              Type.Literal("X"),
              Type.Literal("NAVER"),
              Type.Literal("DEVELOPMENT"),
            ]),
            providerSubject: Type.String({ minLength: 1, maxLength: 255 }),
            displayName: Type.String({ minLength: 1, maxLength: 160 }),
            anonymousSubjectId: Type.Optional(Type.String({ format: "uuid" })),
          }),
          response: {
            201: Type.Object({
              token: Type.String(),
              expiresAt: Type.String({ format: "date-time" }),
              member: memberSchema,
              guestLink: Type.Object({
                linked: Type.Boolean(),
                invalidatedDuplicateVotes: Type.Integer({ minimum: 0 }),
                migratedReactions: Type.Integer({ minimum: 0 }),
                mergedDuplicateReactions: Type.Integer({ minimum: 0 }),
              }),
            }),
            400: errorSchema,
            401: errorSchema,
            403: errorSchema,
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
        const session = await service.createSession(request.body);
        return reply.code(201).send(session);
      },
    );

    identityApp.get<{ Headers: { authorization?: string } }>(
      "/v1/member-session",
      {
        schema: {
          tags: ["identity"],
          summary: "Read the current Member session",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          response: { 200: sessionViewSchema, 401: errorSchema },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const session = token ? await service.getSession(token) : null;
        if (!session) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.send(session);
      },
    );

    identityApp.delete<{ Headers: { authorization?: string } }>(
      "/v1/member-session",
      {
        schema: {
          tags: ["identity"],
          summary: "Revoke the current Member session",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          response: { 204: Type.Null(), 401: errorSchema },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        if (!token || !(await service.revokeSession(token))) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.code(204).send();
      },
    );
  });
}
