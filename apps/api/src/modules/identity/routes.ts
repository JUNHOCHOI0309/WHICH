import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { MemberIdentityService } from "./contracts.js";
import { decodeMemberVoteHistoryCursor } from "./cursor.js";
import { MemberIdentityError } from "./errors.js";

const avatarSchema = Type.Union([
  Type.Object({ kind: Type.Literal("INITIALS"), initials: Type.String() }),
  Type.Object({ kind: Type.Literal("IMAGE"), url: Type.String({ format: "uri" }) }),
]);
const memberSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  displayName: Type.String(),
  status: Type.Union([
    Type.Literal("ACTIVE"),
    Type.Literal("LIMITED"),
    Type.Literal("SUSPENDED"),
    Type.Literal("DELETED"),
  ]),
  avatar: avatarSchema,
});

const errorSchema = Type.Object({ code: Type.String(), message: Type.String() });
const sessionViewSchema = Type.Object({
  expiresAt: Type.String({ format: "date-time" }),
  member: memberSchema,
});
const tokenSessionViewSchema = Type.Intersect([
  sessionViewSchema,
  Type.Object({ token: Type.String({ minLength: 32, maxLength: 128 }) }),
]);
const mobileAuthProofSchema = Type.Object({
  state: Type.String({ minLength: 32, maxLength: 128, pattern: "^[A-Za-z0-9._~-]+$" }),
  nonce: Type.String({ minLength: 32, maxLength: 128, pattern: "^[A-Za-z0-9._~-]+$" }),
});
const identityProviderSchema = Type.Union([
  Type.Literal("EMAIL"),
  Type.Literal("GOOGLE"),
  Type.Literal("X"),
  Type.Literal("NAVER"),
  Type.Literal("KAKAO"),
  Type.Literal("DEVELOPMENT"),
]);
const resultSchema = Type.Object({
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
const privateVoteSchema = Type.Object({
  voteId: Type.String({ format: "uuid" }),
  issueId: Type.String({ format: "uuid" }),
  issueVersion: Type.Integer({ minimum: 1 }),
  question: Type.String(),
  categoryCode: Type.String(),
  choice: Type.Union([Type.Literal("A"), Type.Literal("B")]),
  choiceLabel: Type.String(),
  acceptedAt: Type.String({ format: "date-time" }),
  result: resultSchema,
});
const memberProfileSettingsSchema = Type.Object({
  handle: Type.String({ minLength: 3, maxLength: 30 }),
  bio: Type.Union([Type.String({ maxLength: 160 }), Type.Null()]),
  visibility: Type.Union([Type.Literal("PRIVATE"), Type.Literal("PUBLIC")]),
  publicUrl: Type.Union([Type.String(), Type.Null()]),
});
const privateProfileSchema = Type.Object({
  member: Type.Intersect([
    memberSchema,
    Type.Object({
      avatarSource: Type.Union([
        Type.Literal("INITIALS"),
        Type.Literal("SOCIAL"),
        Type.Literal("CUSTOM"),
      ]),
      joinedAt: Type.String({ format: "date-time" }),
      participationCount: Type.Integer({ minimum: 0 }),
    }),
  ]),
  publicProfile: Type.Union([memberProfileSettingsSchema, Type.Null()]),
  identities: Type.Array(
    Type.Object({
      provider: identityProviderSchema,
      linkedAt: Type.String({ format: "date-time" }),
      lastAuthenticatedAt: Type.String({ format: "date-time" }),
    }),
  ),
  votes: Type.Object({
    items: Type.Array(privateVoteSchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  }),
});
const publicCreatorProfileSchema = Type.Object({
  creator: Type.Object({
    displayName: Type.String(),
    handle: Type.String(),
    bio: Type.Union([Type.String(), Type.Null()]),
    joinedMonth: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}$" }),
    avatar: avatarSchema,
  }),
  stats: Type.Object({
    publishedIssueCount: Type.Integer({ minimum: 0 }),
    acceptedVoteCount: Type.Integer({ minimum: 0 }),
  }),
  issues: Type.Array(
    Type.Object({
      id: Type.String({ format: "uuid" }),
      version: Type.Integer({ minimum: 1 }),
      question: Type.String(),
      categoryCode: Type.String(),
      publishedAt: Type.String({ format: "date-time" }),
      acceptedVoteCount: Type.Integer({ minimum: 0 }),
    }),
  ),
});
const privateVoteLookupSchema = Type.Object({
  outcome: Type.Literal("ACCEPTED"),
  voteAttemptId: Type.String({ format: "uuid" }),
  voteId: Type.String({ format: "uuid" }),
  issueId: Type.String({ format: "uuid" }),
  issueVersion: Type.Integer({ minimum: 1 }),
  choice: Type.Union([Type.Literal("A"), Type.Literal("B")]),
  result: resultSchema,
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
        provider: "EMAIL" | "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";
        providerSubject: string;
        displayName: string;
        avatarUrl?: string;
        anonymousSubjectId?: string;
        createIfMissing?: boolean;
        credential?: { email: string; password: string };
        authRequestKey?: string;
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
              Type.Literal("EMAIL"),
              Type.Literal("GOOGLE"),
              Type.Literal("X"),
              Type.Literal("NAVER"),
              Type.Literal("KAKAO"),
              Type.Literal("DEVELOPMENT"),
            ]),
            providerSubject: Type.String({ minLength: 1, maxLength: 255 }),
            displayName: Type.String({ minLength: 1, maxLength: 160 }),
            avatarUrl: Type.Optional(Type.String({ format: "uri", maxLength: 2048 })),
            anonymousSubjectId: Type.Optional(Type.String({ format: "uuid" })),
            createIfMissing: Type.Optional(Type.Boolean()),
            credential: Type.Optional(
              Type.Object({
                email: Type.String({ minLength: 3, maxLength: 320 }),
                password: Type.String({ minLength: 1, maxLength: 128 }),
              }),
            ),
            authRequestKey: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
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
            429: errorSchema,
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

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: {
        email: string;
        password: string;
        anonymousSubjectId?: string;
        authRequestKey?: string;
      };
    }>(
      "/v1/internal/member-credential-sessions",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            email: Type.String({ minLength: 3, maxLength: 320 }),
            password: Type.String({ minLength: 1, maxLength: 128 }),
            anonymousSubjectId: Type.Optional(Type.String({ format: "uuid" })),
            authRequestKey: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
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
            429: errorSchema,
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
        const session = await service.createCredentialSession(request.body);
        return reply.code(201).send(session);
      },
    );

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: { email: string; authRequestKey?: string };
    }>(
      "/v1/internal/member-email-verification-requests",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            email: Type.String({ minLength: 3, maxLength: 320 }),
            authRequestKey: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
          }),
          response: {
            200: Type.Union([
              Type.Object({
                email: Type.String(),
                token: Type.String(),
                expiresAt: Type.String({ format: "date-time" }),
              }),
              Type.Null(),
            ]),
            400: errorSchema,
            401: errorSchema,
            429: errorSchema,
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
        return service.requestEmailVerification(request.body);
      },
    );

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: { token: string; authRequestKey?: string };
    }>(
      "/v1/internal/member-email-verifications",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            token: Type.String({ minLength: 32, maxLength: 256 }),
            authRequestKey: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
          }),
          response: {
            200: Type.Object({ verified: Type.Literal(true) }),
            400: errorSchema,
            401: errorSchema,
            429: errorSchema,
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
        return service.verifyEmail(request.body);
      },
    );

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: { email: string; authRequestKey?: string };
    }>(
      "/v1/internal/member-password-reset-requests",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            email: Type.String({ minLength: 3, maxLength: 320 }),
            authRequestKey: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
          }),
          response: {
            200: Type.Union([
              Type.Object({
                email: Type.String(),
                token: Type.String(),
                expiresAt: Type.String({ format: "date-time" }),
              }),
              Type.Null(),
            ]),
            400: errorSchema,
            401: errorSchema,
            429: errorSchema,
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
        return service.requestPasswordReset(request.body);
      },
    );

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: { token: string; password: string; authRequestKey?: string };
    }>(
      "/v1/internal/member-password-resets",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            token: Type.String({ minLength: 32, maxLength: 256 }),
            password: Type.String({ minLength: 1, maxLength: 128 }),
            authRequestKey: Type.Optional(Type.String({ minLength: 16, maxLength: 128 })),
          }),
          response: {
            200: Type.Object({ reset: Type.Literal(true) }),
            400: errorSchema,
            401: errorSchema,
            429: errorSchema,
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
        return service.resetPassword(request.body);
      },
    );

    identityApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: {
        memberId: string;
        provider: "GOOGLE" | "X" | "NAVER" | "KAKAO" | "DEVELOPMENT";
        providerSubject: string;
        displayName: string;
        avatarUrl?: string;
      };
    }>(
      "/v1/internal/member-identity-links",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            memberId: Type.String({ format: "uuid" }),
            provider: identityProviderSchema,
            providerSubject: Type.String({ minLength: 1, maxLength: 255 }),
            displayName: Type.String({ minLength: 1, maxLength: 160 }),
            avatarUrl: Type.Optional(Type.String({ format: "uri", maxLength: 2048 })),
          }),
          response: {
            201: Type.Object({
              token: Type.String(),
              expiresAt: Type.String({ format: "date-time" }),
              member: memberSchema,
              identity: Type.Object({
                provider: identityProviderSchema,
                linked: Type.Boolean(),
                memberMerged: Type.Boolean(),
              }),
            }),
            400: errorSchema,
            401: errorSchema,
            403: errorSchema,
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
        const result = await service.linkIdentity(request.body.memberId, request.body);
        return reply.code(201).send(result);
      },
    );

    identityApp.put<{
      Headers: { authorization?: string; "x-internal-auth-secret"?: string };
      Body: {
        avatarUrl: string;
        objectKey: string;
        sourceProvider?: "GOOGLE" | "X" | "NAVER" | "KAKAO";
        expectedSourceUrl?: string;
      };
    }>(
      "/v1/internal/member-avatar",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-internal-auth-secret": Type.Optional(Type.String()),
            },
            { additionalProperties: true },
          ),
          body: Type.Object({
            avatarUrl: Type.String({ format: "uri", maxLength: 2048 }),
            objectKey: Type.String({ minLength: 1, maxLength: 512 }),
            sourceProvider: Type.Optional(
              Type.Union([
                Type.Literal("GOOGLE"),
                Type.Literal("X"),
                Type.Literal("NAVER"),
                Type.Literal("KAKAO"),
              ]),
            ),
            expectedSourceUrl: Type.Optional(Type.String({ format: "uri", maxLength: 2048 })),
          }),
          response: {
            200: Type.Object({
              updated: Type.Boolean(),
              member: memberSchema,
              replacedObjectKey: Type.Union([Type.String(), Type.Null()]),
            }),
            400: errorSchema,
            401: errorSchema,
            403: errorSchema,
          },
        },
      },
      async (request, reply) => {
        if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
          return reply
            .code(401)
            .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        }
        const token = bearerToken(request.headers.authorization);
        const result = token ? await service.setAvatar(token, request.body) : null;
        if (!result) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.send(result);
      },
    );

    identityApp.delete<{
      Headers: { authorization?: string; "x-internal-auth-secret"?: string };
    }>(
      "/v1/internal/member-avatar",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            {
              authorization: Type.Optional(Type.String()),
              "x-internal-auth-secret": Type.Optional(Type.String()),
            },
            { additionalProperties: true },
          ),
          response: {
            200: Type.Object({
              updated: Type.Boolean(),
              member: memberSchema,
              replacedObjectKey: Type.Union([Type.String(), Type.Null()]),
            }),
            401: errorSchema,
            403: errorSchema,
          },
        },
      },
      async (request, reply) => {
        if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
          return reply
            .code(401)
            .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        }
        const token = bearerToken(request.headers.authorization);
        const result = token ? await service.clearAvatar(token) : null;
        if (!result) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.send(result);
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

    identityApp.post<{
      Headers: { authorization?: string };
      Body: { codeChallenge: string; state: string; nonce: string };
    }>(
      "/v1/mobile-auth/exchange-tickets",
      {
        schema: {
          tags: ["identity"],
          summary: "Issue a one-time PKCE ticket for a Native Member session",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Intersect([
            mobileAuthProofSchema,
            Type.Object({
              codeChallenge: Type.String({
                minLength: 43,
                maxLength: 43,
                pattern: "^[A-Za-z0-9_-]+$",
              }),
            }),
          ]),
          response: {
            201: Type.Object({
              ticket: Type.String({ minLength: 43, maxLength: 43 }),
              expiresAt: Type.String({ format: "date-time" }),
            }),
            400: errorSchema,
            401: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const ticket = token
          ? await service.issueMobileAuthExchangeTicket(token, request.body)
          : null;
        if (!ticket) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.code(201).send(ticket);
      },
    );

    identityApp.post<{
      Body: {
        ticket: string;
        codeVerifier: string;
        state: string;
        nonce: string;
        anonymousSubjectId?: string;
      };
    }>(
      "/v1/mobile-auth/member-sessions",
      {
        schema: {
          tags: ["identity"],
          summary: "Exchange a one-time PKCE ticket for a Native Member session",
          body: Type.Intersect([
            mobileAuthProofSchema,
            Type.Object({
              ticket: Type.String({
                minLength: 43,
                maxLength: 43,
                pattern: "^[A-Za-z0-9_-]+$",
              }),
              codeVerifier: Type.String({
                minLength: 43,
                maxLength: 128,
                pattern: "^[A-Za-z0-9._~-]+$",
              }),
              anonymousSubjectId: Type.Optional(Type.String({ format: "uuid" })),
            }),
          ]),
          response: { 201: tokenSessionViewSchema, 400: errorSchema },
        },
      },
      async (request, reply) =>
        reply.code(201).send(await service.exchangeMobileAuthTicket(request.body)),
    );

    identityApp.post<{ Headers: { authorization?: string } }>(
      "/v1/member-session/refresh",
      {
        schema: {
          tags: ["identity"],
          summary: "Rotate the current Member session token",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          response: { 201: tokenSessionViewSchema, 401: errorSchema },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const refreshed = token ? await service.refreshSession(token) : null;
        if (!refreshed) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.code(201).send(refreshed);
      },
    );

    identityApp.get<{
      Headers: { authorization?: string };
      Querystring: { limit?: number; cursor?: string };
    }>(
      "/v1/me",
      {
        schema: {
          tags: ["identity"],
          summary: "Read the current Member private profile and vote history",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 12 })),
            cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
          }),
          response: { 200: privateProfileSchema, 400: errorSchema, 401: errorSchema },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const profile = token
          ? await service.getPrivateProfile(token, {
              limit: request.query.limit ?? 12,
              cursor: request.query.cursor
                ? decodeMemberVoteHistoryCursor(request.query.cursor)
                : undefined,
            })
          : null;
        if (!profile) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.send(profile);
      },
    );

    identityApp.patch<{
      Headers: { authorization?: string };
      Body: { handle: string; bio: string | null; visibility: "PRIVATE" | "PUBLIC" };
    }>(
      "/v1/me/profile",
      {
        schema: {
          tags: ["identity"],
          summary: "Create or update the current Member public profile settings",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            handle: Type.String({ minLength: 3, maxLength: 30, pattern: "^[A-Za-z0-9_]+$" }),
            bio: Type.Union([Type.String({ maxLength: 160 }), Type.Null()]),
            visibility: Type.Union([Type.Literal("PRIVATE"), Type.Literal("PUBLIC")]),
          }),
          response: {
            200: memberProfileSettingsSchema,
            400: errorSchema,
            401: errorSchema,
            409: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const profile = token ? await service.updateProfile(token, request.body) : null;
        if (!profile) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.send(profile);
      },
    );

    identityApp.delete<{
      Headers: { authorization?: string };
      Body: { password: string; confirmation: "DELETE" };
    }>(
      "/v1/me",
      {
        schema: {
          tags: ["identity"],
          summary: "Delete and anonymize the current Member account",
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            password: Type.String({ minLength: 1, maxLength: 128 }),
            confirmation: Type.Literal("DELETE"),
          }),
          response: {
            200: Type.Object({
              deleted: Type.Literal(true),
              deletedAvatarObjectKey: Type.Optional(Type.String()),
            }),
            400: errorSchema,
            401: errorSchema,
            409: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const result = token ? await service.deleteAccount(token, request.body.password) : null;
        if (!result) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        return reply.send(result);
      },
    );

    identityApp.get<{ Params: { handle: string } }>(
      "/v1/profiles/:handle",
      {
        schema: {
          tags: ["identity"],
          summary: "Read a public Creator profile by handle",
          params: Type.Object({
            handle: Type.String({ minLength: 3, maxLength: 30, pattern: "^[A-Za-z0-9_]+$" }),
          }),
          response: { 200: publicCreatorProfileSchema, 404: errorSchema },
        },
      },
      async (request, reply) => {
        const profile = await service.getPublicCreatorProfile(request.params.handle);
        if (!profile) {
          return reply.code(404).send({
            code: "PROFILE_NOT_FOUND",
            message: "The requested public profile does not exist.",
          });
        }
        return reply.send(profile);
      },
    );

    identityApp.get<{
      Headers: { authorization?: string };
      Params: { issueId: string };
    }>(
      "/v1/me/votes/:issueId",
      {
        schema: {
          tags: ["identity"],
          summary: "Restore the current Member's accepted vote for an Issue",
          params: Type.Object({ issueId: Type.String({ format: "uuid" }) }),
          headers: Type.Object(
            { authorization: Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          response: {
            200: privateVoteLookupSchema,
            401: errorSchema,
            404: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const token = bearerToken(request.headers.authorization);
        const result = token ? await service.findPrivateVote(token, request.params.issueId) : null;
        if (!result) {
          return reply.code(401).send({
            code: "SESSION_INVALID",
            message: "The Member session is invalid or expired.",
          });
        }
        if (!result.vote) {
          return reply.code(404).send({
            code: "VOTE_NOT_FOUND",
            message: "No accepted vote exists for this Member and Issue.",
          });
        }
        return reply.send(result.vote);
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
