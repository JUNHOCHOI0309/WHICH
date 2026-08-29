import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";

import {
  ISSUE_MEDIA_REVIEW_ACTIONS,
  ISSUE_MEDIA_REVIEW_STATUSES,
  ISSUE_MEDIA_RIGHTS_TYPES,
  type IssueMediaReviewService,
} from "./review-contracts.js";
import { IssueMediaError } from "./service.js";

const uuid = Type.String({ format: "uuid" });
const headersSchema = Type.Object(
  {
    authorization: Type.Optional(Type.String()),
    "x-internal-auth-secret": Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
type Headers = { authorization?: string; "x-internal-auth-secret"?: string };

function sameSecret(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function registerIssueMediaReviewRoutes(
  app: FastifyInstance,
  service: IssueMediaReviewService,
  identity: MemberIdentityService,
  internalSecret: string,
) {
  await app.register((reviewApp) => {
    async function authenticate(
      request: FastifyRequest<{ Headers: Headers }>,
      reply: FastifyReply,
    ) {
      if (!sameSecret(request.headers["x-internal-auth-secret"], internalSecret)) {
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

    function forbidden(reply: FastifyReply) {
      return reply
        .code(403)
        .send({ code: "OPERATOR_ROLE_REQUIRED", message: "Active OPERATOR access is required." });
    }

    reviewApp.setErrorHandler((error, request, reply) => {
      if (error instanceof IssueMediaError) {
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
          message: "The media review request does not match the contract.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "ISSUE_MEDIA_REVIEW_FAILED",
        message: "The Issue media review operation failed.",
      });
    });

    reviewApp.get<{
      Headers: Headers;
      Querystring: {
        status?: (typeof ISSUE_MEDIA_REVIEW_STATUSES)[number];
        q?: string;
        limit?: number;
      };
    }>(
      "/v1/internal/ops/media-review/assets",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          querystring: Type.Object({
            status: Type.Optional(
              Type.Union(ISSUE_MEDIA_REVIEW_STATUSES.map((value) => Type.Literal(value))),
            ),
            q: Type.Optional(Type.String({ maxLength: 120 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const page = await service.readAssets({
          memberId,
          status: request.query.status,
          query: request.query.q?.trim(),
          limit: request.query.limit ?? 25,
          requestId: request.id,
        });
        if (!page) return forbidden(reply);
        return reply.send(page);
      },
    );

    reviewApp.get<{ Headers: Headers; Params: { assetId: string } }>(
      "/v1/internal/ops/media-review/assets/:assetId/content",
      { schema: { hide: true, headers: headersSchema, params: Type.Object({ assetId: uuid }) } },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const body = await service.readAssetContent({
          memberId,
          assetId: request.params.assetId,
          requestId: request.id,
        });
        if (!body) return forbidden(reply);
        return reply
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff")
          .type("image/webp")
          .send(body);
      },
    );

    reviewApp.put<{
      Headers: Headers;
      Params: { assetId: string };
      Body: {
        status: (typeof ISSUE_MEDIA_REVIEW_ACTIONS)[number];
        reasonCode: string;
        rationale: string;
        policyVersion: string;
      };
    }>(
      "/v1/internal/ops/media-review/assets/:assetId/decision",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          params: Type.Object({ assetId: uuid }),
          body: Type.Object({
            status: Type.Union(ISSUE_MEDIA_REVIEW_ACTIONS.map((value) => Type.Literal(value))),
            reasonCode: Type.String({ minLength: 2, maxLength: 64, pattern: "^[A-Z0-9_]+$" }),
            rationale: Type.String({ minLength: 10, maxLength: 2000 }),
            policyVersion: Type.String({ minLength: 3, maxLength: 64 }),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const asset = await service.decideAsset({
          memberId,
          assetId: request.params.assetId,
          ...request.body,
          requestId: request.id,
        });
        if (!asset) return forbidden(reply);
        return reply.send(asset);
      },
    );

    reviewApp.put<{
      Headers: Headers;
      Params: { issueId: string };
      Body: {
        status: "HIDDEN" | "RESTORED" | "DELETED";
        reasonCode: string;
        rationale: string;
        policyVersion: string;
      };
    }>(
      "/v1/internal/ops/media-review/issues/:issueId/decision",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          params: Type.Object({ issueId: uuid }),
          body: Type.Object({
            status: Type.Union([
              Type.Literal("HIDDEN"),
              Type.Literal("RESTORED"),
              Type.Literal("DELETED"),
            ]),
            reasonCode: Type.String({ minLength: 2, maxLength: 64, pattern: "^[A-Z0-9_]+$" }),
            rationale: Type.String({ minLength: 10, maxLength: 2000 }),
            policyVersion: Type.String({ minLength: 3, maxLength: 64 }),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.decideIssue({
          memberId,
          issueId: request.params.issueId,
          ...request.body,
          requestId: request.id,
        });
        if (!result) return forbidden(reply);
        return reply.send(result);
      },
    );

    reviewApp.get<{
      Headers: Headers;
      Querystring: { status?: "OPEN" | "ACTIONED" | "DISMISSED"; limit?: number };
    }>(
      "/v1/internal/ops/media-review/rights-requests",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          querystring: Type.Object({
            status: Type.Optional(
              Type.Union([
                Type.Literal("OPEN"),
                Type.Literal("ACTIONED"),
                Type.Literal("DISMISSED"),
              ]),
            ),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const items = await service.readRightsRequests({
          memberId,
          status: request.query.status,
          limit: request.query.limit ?? 50,
          requestId: request.id,
        });
        if (!items) return forbidden(reply);
        return reply.send({ schemaVersion: 1, generatedAt: new Date().toISOString(), items });
      },
    );

    reviewApp.post<{
      Headers: Headers;
      Body: {
        requestType: (typeof ISSUE_MEDIA_RIGHTS_TYPES)[number];
        assetId?: string;
        issueId?: string;
        requesterReference: string;
        details: string;
        policyVersion: string;
      };
    }>(
      "/v1/internal/ops/media-review/rights-requests",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          body: Type.Object({
            requestType: Type.Union(ISSUE_MEDIA_RIGHTS_TYPES.map((value) => Type.Literal(value))),
            assetId: Type.Optional(uuid),
            issueId: Type.Optional(uuid),
            requesterReference: Type.String({ minLength: 3, maxLength: 300 }),
            details: Type.String({ minLength: 10, maxLength: 4000 }),
            policyVersion: Type.String({ minLength: 3, maxLength: 64 }),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        if (!request.body.assetId && !request.body.issueId) {
          return reply.code(400).send({
            code: "RIGHTS_TARGET_REQUIRED",
            message: "Asset 또는 Issue 대상을 입력해야 합니다.",
          });
        }
        const item = await service.createRightsRequest({
          memberId,
          ...request.body,
          requestId: request.id,
        });
        if (!item) return forbidden(reply);
        return reply.code(201).send(item);
      },
    );

    reviewApp.put<{
      Headers: Headers;
      Params: { requestId: string };
      Body: { status: "ACTIONED" | "DISMISSED"; resolution: string };
    }>(
      "/v1/internal/ops/media-review/rights-requests/:requestId/resolve",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          params: Type.Object({ requestId: uuid }),
          body: Type.Object({
            status: Type.Union([Type.Literal("ACTIONED"), Type.Literal("DISMISSED")]),
            resolution: Type.String({ minLength: 10, maxLength: 4000 }),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const item = await service.resolveRightsRequest({
          memberId,
          requestIdValue: request.params.requestId,
          ...request.body,
          requestId: request.id,
        });
        if (!item) return forbidden(reply);
        return reply.send(item);
      },
    );
  });
}
