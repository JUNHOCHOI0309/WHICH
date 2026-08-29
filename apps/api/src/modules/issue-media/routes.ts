import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";

import { ISSUE_MEDIA_INPUT_MIME_TYPES, type IssueMediaService } from "./contracts.js";
import { IssueMediaError } from "./service.js";
import {
  IssueMediaUploadGateError,
  type IssueMediaUploadGateService,
} from "./upload-gate-service.js";

const uuid = Type.String({ format: "uuid" });
const opsHeaders = Type.Object(
  {
    authorization: Type.Optional(Type.String()),
    "x-internal-auth-secret": Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const memberHeaders = Type.Object(
  { authorization: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
type Headers = { authorization?: string; "x-internal-auth-secret"?: string };

function plainBase64(value: string) {
  const normalized = value.trim();
  return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length % 4 === 0
    ? normalized
    : null;
}

function secretMatches(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function registerIssueMediaRoutes(
  app: FastifyInstance,
  service: IssueMediaService,
  identity: MemberIdentityService,
  internalSecret: string,
  uploadGate?: IssueMediaUploadGateService,
) {
  await app.register((mediaApp) => {
    async function authenticateMember(
      request: FastifyRequest<{ Headers: Headers }>,
      reply: FastifyReply,
    ) {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : "";
      const session = token ? await identity.getSession(token) : null;
      if (!session) {
        await reply
          .code(401)
          .send({ code: "SESSION_INVALID", message: "Member session required." });
        return null;
      }
      return session.member.id;
    }

    async function authenticate(
      request: FastifyRequest<{ Headers: Headers }>,
      reply: FastifyReply,
    ) {
      if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
        await reply.code(401).send({ code: "UNAUTHORIZED", message: "Internal auth failed." });
        return null;
      }
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : "";
      const session = token ? await identity.getSession(token) : null;
      if (!session) {
        await reply
          .code(401)
          .send({ code: "SESSION_INVALID", message: "Member session required." });
        return null;
      }
      return session.member.id;
    }

    function operatorRequired(reply: FastifyReply) {
      return reply.code(403).send({
        code: "OPERATOR_ROLE_REQUIRED",
        message: "Active OPERATOR access is required.",
      });
    }

    mediaApp.setErrorHandler((error, request, reply) => {
      if (error instanceof IssueMediaError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      if (error instanceof IssueMediaUploadGateError) {
        return reply.code(error.statusCode).send({
          code: error.code,
          message: error.message,
          reasons: error.reasons,
        });
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        error.validation
      ) {
        return reply.code(400).send({
          code: "INVALID_REQUEST",
          message: "The Issue media request does not match the contract.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "ISSUE_MEDIA_FAILED",
        message: "The Issue media operation failed.",
      });
    });

    mediaApp.get<{
      Headers: Headers;
      Querystring: { q?: string; categoryCode?: string; limit?: number };
    }>(
      "/v1/member/issue-media-library",
      {
        schema: {
          tags: ["issues"],
          summary: "Search approved reusable A/B image pairs",
          headers: memberHeaders,
          querystring: Type.Object({
            q: Type.Optional(Type.String({ maxLength: 120 })),
            categoryCode: Type.Optional(Type.String({ maxLength: 64 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticateMember(request, reply);
        if (!memberId) return;
        return service.listLibraryPairs({
          query: request.query.q,
          categoryCode: request.query.categoryCode,
          limit: request.query.limit ?? 20,
        });
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Body: {
        title: string;
        categoryCode: string;
        topics: string[];
        assets: Array<{
          side: "A" | "B";
          mediaAssetId: string;
          altText: string;
          cropMode: "COVER" | "CONTAIN";
          sourceUrl: string;
          authorName: string;
          licenseName: string;
          licenseVersion: string;
          acquiredAt: string;
          commercialAllowed: boolean;
          derivativeAllowed: boolean;
          redistributionAllowed: boolean;
          attributionText?: string | null;
          evidenceReference: string;
          expiresAt?: string | null;
        }>;
      };
    }>(
      "/v1/internal/ops/media-library",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          body: Type.Object(
            {
              title: Type.String({ minLength: 2, maxLength: 160 }),
              categoryCode: Type.String({ minLength: 1, maxLength: 64 }),
              topics: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
                maxItems: 20,
              }),
              assets: Type.Array(
                Type.Object(
                  {
                    side: Type.Union([Type.Literal("A"), Type.Literal("B")]),
                    mediaAssetId: uuid,
                    altText: Type.String({ minLength: 2, maxLength: 300 }),
                    cropMode: Type.Union([Type.Literal("COVER"), Type.Literal("CONTAIN")]),
                    sourceUrl: Type.String({ minLength: 8, maxLength: 2000 }),
                    authorName: Type.String({ minLength: 1, maxLength: 200 }),
                    licenseName: Type.String({ minLength: 1, maxLength: 160 }),
                    licenseVersion: Type.String({ minLength: 1, maxLength: 80 }),
                    acquiredAt: Type.String({ format: "date-time" }),
                    commercialAllowed: Type.Boolean(),
                    derivativeAllowed: Type.Boolean(),
                    redistributionAllowed: Type.Boolean(),
                    attributionText: Type.Optional(
                      Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
                    ),
                    evidenceReference: Type.String({ minLength: 8, maxLength: 2000 }),
                    expiresAt: Type.Optional(
                      Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
                    ),
                  },
                  { additionalProperties: false },
                ),
                { minItems: 2, maxItems: 2 },
              ),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const pair = await service.registerLibraryPair({
          memberId,
          pair: request.body,
          requestId: request.id,
        });
        if (!pair) return operatorRequired(reply);
        return reply.code(201).send({ pair });
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Params: { pairId: string };
      Body: { reason: string };
    }>(
      "/v1/internal/ops/media-library/:pairId/revoke",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({ pairId: uuid }),
          body: Type.Object(
            { reason: Type.String({ minLength: 10, maxLength: 2000 }) },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.revokeLibraryPair({
          memberId,
          pairId: request.params.pairId,
          reason: request.body.reason,
          requestId: request.id,
        });
        if (!result) return operatorRequired(reply);
        return reply.send(result);
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Body: { submissionId: string; consentVersion: string };
    }>(
      "/v1/member/issue-media-upload-sessions",
      {
        schema: {
          tags: ["issues"],
          summary: "Create a short-lived one-time Member media upload session",
          headers: memberHeaders,
          body: Type.Object(
            {
              submissionId: uuid,
              consentVersion: Type.String({ minLength: 1, maxLength: 64 }),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticateMember(request, reply);
        if (!memberId) return;
        if (!uploadGate) {
          throw new IssueMediaUploadGateError(
            "MEDIA_UPLOAD_NOT_AVAILABLE",
            403,
            "Member image upload is disabled.",
            ["MODE_DISABLED"],
          );
        }
        const session = await uploadGate.createSession({
          memberId,
          submissionId: request.body.submissionId,
          consentVersion: request.body.consentVersion,
          ipAddress: request.ip,
        });
        return reply.code(201).send({ session });
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Body: {
        uploadSessionId: string;
        uploadSessionToken: string;
        rightsAttestation: string;
        declaredMimeType: (typeof ISSUE_MEDIA_INPUT_MIME_TYPES)[number];
        contentBase64: string;
      };
    }>(
      "/v1/member/issue-submission-media",
      {
        bodyLimit: 14 * 1024 * 1024,
        schema: {
          tags: ["issues"],
          summary: "Stage one Member-owned selection image for editorial review",
          headers: memberHeaders,
          body: Type.Object(
            {
              rightsAttestation: Type.String({ minLength: 20, maxLength: 2000 }),
              uploadSessionId: uuid,
              uploadSessionToken: Type.String({ minLength: 32, maxLength: 128 }),
              declaredMimeType: Type.Union(
                ISSUE_MEDIA_INPUT_MIME_TYPES.map((value) => Type.Literal(value)),
              ),
              contentBase64: Type.String({ minLength: 4, maxLength: 13_981_016 }),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticateMember(request, reply);
        if (!memberId) return;
        const normalized = plainBase64(request.body.contentBase64);
        if (!normalized) {
          return reply.code(400).send({
            code: "INVALID_IMAGE_ENCODING",
            message: "contentBase64 must contain a plain base64-encoded file.",
          });
        }
        if (!uploadGate) {
          throw new IssueMediaUploadGateError(
            "MEDIA_UPLOAD_NOT_AVAILABLE",
            403,
            "Member image upload is disabled.",
            ["MODE_DISABLED"],
          );
        }
        await uploadGate.consumeSession({
          memberId,
          sessionId: request.body.uploadSessionId,
          token: request.body.uploadSessionToken,
          byteSize: Buffer.byteLength(normalized, "base64"),
        });
        const asset = await service.stageMemberAsset({
          memberId,
          uploadSessionId: request.body.uploadSessionId,
          rightsAttestation: request.body.rightsAttestation,
          declaredMimeType: request.body.declaredMimeType,
          bytes: Buffer.from(normalized, "base64"),
          requestId: request.id,
        });
        return reply.code(201).send({ asset });
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Body: {
        sourceType: "OPERATOR_UPLOAD";
        rightsAttestation: string;
        declaredMimeType: (typeof ISSUE_MEDIA_INPUT_MIME_TYPES)[number];
        contentBase64: string;
      };
    }>(
      "/v1/internal/ops/media-assets",
      {
        bodyLimit: 14 * 1024 * 1024,
        schema: {
          hide: true,
          headers: opsHeaders,
          body: Type.Object(
            {
              sourceType: Type.Literal("OPERATOR_UPLOAD"),
              rightsAttestation: Type.String({ minLength: 20, maxLength: 2000 }),
              declaredMimeType: Type.Union(
                ISSUE_MEDIA_INPUT_MIME_TYPES.map((value) => Type.Literal(value)),
              ),
              contentBase64: Type.String({ minLength: 4, maxLength: 13_981_016 }),
              sourceUrl: Type.Optional(Type.Never()),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const normalized = plainBase64(request.body.contentBase64);
        if (!normalized) {
          return reply.code(400).send({
            code: "INVALID_IMAGE_ENCODING",
            message: "contentBase64 must contain a plain base64-encoded file.",
          });
        }
        const asset = await service.stageAsset({
          memberId,
          sourceType: request.body.sourceType,
          rightsAttestation: request.body.rightsAttestation,
          declaredMimeType: request.body.declaredMimeType,
          bytes: Buffer.from(normalized, "base64"),
          requestId: request.id,
        });
        if (!asset) return operatorRequired(reply);
        return reply.code(201).send({ asset });
      },
    );

    mediaApp.post<{ Headers: Headers; Params: { assetId: string } }>(
      "/v1/internal/ops/media-assets/:assetId/publish",
      { schema: { hide: true, headers: opsHeaders, params: Type.Object({ assetId: uuid }) } },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const asset = await service.approveAndPublish({
          memberId,
          assetId: request.params.assetId,
          requestId: request.id,
        });
        if (!asset) return operatorRequired(reply);
        return reply.send({ asset });
      },
    );

    mediaApp.put<{
      Headers: Headers;
      Params: { issueId: string; issueVersion: number; choiceId: string };
      Body: {
        assetId: string;
        altText: string;
        cropMode: "COVER" | "CONTAIN";
        displayPosition: 0 | 1;
      };
    }>(
      "/v1/internal/ops/issues/:issueId/versions/:issueVersion/choices/:choiceId/media",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({
            issueId: uuid,
            issueVersion: Type.Integer({ minimum: 1 }),
            choiceId: uuid,
          }),
          body: Type.Object(
            {
              assetId: uuid,
              altText: Type.String({ minLength: 2, maxLength: 300 }),
              cropMode: Type.Union([Type.Literal("COVER"), Type.Literal("CONTAIN")]),
              displayPosition: Type.Union([Type.Literal(0), Type.Literal(1)]),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.attachChoice({
          memberId,
          ...request.params,
          ...request.body,
          requestId: request.id,
        });
        if (!result) return operatorRequired(reply);
        return reply.send(result);
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Params: { issueId: string };
      Body: { reason: "ISSUE_BLINDED" | "RIGHTS_CHALLENGED" };
    }>(
      "/v1/internal/ops/issues/:issueId/media/quarantine",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({ issueId: uuid }),
          body: Type.Object({
            reason: Type.Union([Type.Literal("ISSUE_BLINDED"), Type.Literal("RIGHTS_CHALLENGED")]),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.quarantineIssue({
          memberId,
          issueId: request.params.issueId,
          reason: request.body.reason,
          requestId: request.id,
        });
        if (!result) return operatorRequired(reply);
        return reply.send(result);
      },
    );

    mediaApp.delete<{
      Headers: Headers;
      Params: { issueId: string };
      Body: { reason: "ISSUE_DELETED" | "RIGHTS_WITHDRAWN" };
    }>(
      "/v1/internal/ops/issues/:issueId/media",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({ issueId: uuid }),
          body: Type.Object({
            reason: Type.Union([Type.Literal("ISSUE_DELETED"), Type.Literal("RIGHTS_WITHDRAWN")]),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.purgeIssue({
          memberId,
          issueId: request.params.issueId,
          reason: request.body.reason,
          requestId: request.id,
        });
        if (!result) return operatorRequired(reply);
        return reply.send(result);
      },
    );

    mediaApp.delete<{
      Headers: Headers;
      Params: { issueId: string; issueVersion: number; choiceId: string };
    }>(
      "/v1/internal/ops/issues/:issueId/versions/:issueVersion/choices/:choiceId/media",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({
            issueId: uuid,
            issueVersion: Type.Integer({ minimum: 1 }),
            choiceId: uuid,
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.detachChoice({
          memberId,
          ...request.params,
          requestId: request.id,
        });
        if (!result) return operatorRequired(reply);
        return reply.send(result);
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Params: { assetId: string };
      Body: { reason: "ISSUE_BLINDED" | "RIGHTS_CHALLENGED" | "MODERATION_REVOKED" };
    }>(
      "/v1/internal/ops/media-assets/:assetId/quarantine",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({ assetId: uuid }),
          body: Type.Object({
            reason: Type.Union([
              Type.Literal("ISSUE_BLINDED"),
              Type.Literal("RIGHTS_CHALLENGED"),
              Type.Literal("MODERATION_REVOKED"),
            ]),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const asset = await service.quarantineAsset({
          memberId,
          assetId: request.params.assetId,
          reason: request.body.reason,
          requestId: request.id,
        });
        if (!asset) return operatorRequired(reply);
        return reply.send({ asset });
      },
    );

    mediaApp.delete<{
      Headers: Headers;
      Params: { assetId: string };
      Body: { reason: "ISSUE_DELETED" | "RIGHTS_WITHDRAWN" | "ORPHAN_CLEANUP" };
    }>(
      "/v1/internal/ops/media-assets/:assetId",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          params: Type.Object({ assetId: uuid }),
          body: Type.Object({
            reason: Type.Union([
              Type.Literal("ISSUE_DELETED"),
              Type.Literal("RIGHTS_WITHDRAWN"),
              Type.Literal("ORPHAN_CLEANUP"),
            ]),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const asset = await service.purgeAsset({
          memberId,
          assetId: request.params.assetId,
          reason: request.body.reason,
          requestId: request.id,
        });
        if (!asset) return operatorRequired(reply);
        return reply.send({ asset });
      },
    );

    mediaApp.post<{
      Headers: Headers;
      Body: { olderThanHours?: number };
    }>(
      "/v1/internal/ops/media-assets/orphans/purge",
      {
        schema: {
          hide: true,
          headers: opsHeaders,
          body: Type.Object({
            olderThanHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.purgeOrphans({
          memberId,
          olderThanHours: request.body.olderThanHours ?? 24,
          requestId: request.id,
        });
        if (!result) return operatorRequired(reply);
        return reply.send(result);
      },
    );
  });
}
