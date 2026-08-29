import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";

import {
  OPS_DASHBOARD_WINDOWS,
  OPS_EDITORIAL_SCOPES,
  OPS_EDITORIAL_STATUSES,
  OPS_MEMBER_STATUSES,
  OPS_POINT_SHOP_EQUIP_SLOTS,
  OPS_POINT_SHOP_THEME_FAMILIES,
  OpsPointShopConflictError,
  OpsReviewConflictError,
  type OpsDashboardService,
  type OpsDashboardWindow,
} from "./contracts.js";

const opsHeadersSchema = Type.Object(
  {
    authorization: Type.Optional(Type.String()),
    "x-internal-auth-secret": Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

type OpsHeaders = { authorization?: string; "x-internal-auth-secret"?: string };

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

export async function registerOpsRoutes(
  app: FastifyInstance,
  service: OpsDashboardService,
  identity: MemberIdentityService,
  internalSecret: string,
) {
  await app.register((opsApp) => {
    async function authenticate(
      request: FastifyRequest<{ Headers: OpsHeaders }>,
      reply: FastifyReply,
    ) {
      if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
        await reply
          .code(401)
          .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        return null;
      }
      const token = bearerToken(request.headers.authorization);
      const session = token ? await identity.getSession(token) : null;
      if (!session) {
        await reply
          .code(401)
          .send({ code: "SESSION_INVALID", message: "A valid Member session is required." });
        return null;
      }
      return session.member.id;
    }

    opsApp.setErrorHandler((error, request, reply) => {
      if (error instanceof OpsPointShopConflictError) {
        return reply.code(409).send({
          code: "POINT_SHOP_CONFLICT",
          message: error.message,
        });
      }
      if (error instanceof OpsReviewConflictError) {
        return reply.code(409).send({
          code: "REVISION_CONFLICT",
          message: "다른 운영자가 먼저 이 후보의 심사 결정을 변경했습니다.",
          current: error.current,
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
          message: "The operator dashboard request does not match the contract.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "OPS_DASHBOARD_FAILED",
        message: "The operator dashboard snapshot could not be read.",
      });
    });

    opsApp.post<{
      Headers: OpsHeaders;
      Body: {
        eventId: string;
        emailId: string;
        messageId: string | null;
        sender: string;
        recipient: string;
        subject: string;
        receivedAt: string;
        attachmentCount: number;
      };
    }>(
      "/v1/internal/ops/support-email-events",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          body: Type.Object({
            eventId: Type.String({ minLength: 1, maxLength: 128 }),
            emailId: Type.String({ minLength: 1, maxLength: 128 }),
            messageId: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
            sender: Type.String({ minLength: 3, maxLength: 320 }),
            recipient: Type.String({ minLength: 3, maxLength: 320 }),
            subject: Type.String({ maxLength: 300 }),
            receivedAt: Type.String({ format: "date-time" }),
            attachmentCount: Type.Integer({ minimum: 0, maximum: 100 }),
          }),
          response: {
            200: Type.Object({
              status: Type.Union([Type.Literal("RECORDED"), Type.Literal("REPLAYED")]),
            }),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
          return reply
            .code(401)
            .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        }
        const status = await service.recordSupportEmailEvent(request.body);
        return reply.send({ status });
      },
    );

    opsApp.get<{
      Headers: { authorization?: string; "x-internal-auth-secret"?: string };
      Querystring: { days?: number };
    }>(
      "/v1/internal/ops/dashboard",
      {
        schema: {
          hide: true,
          headers: Type.Object(opsHeadersSchema.properties, { additionalProperties: true }),
          querystring: Type.Object({
            days: Type.Optional(
              Type.Union(OPS_DASHBOARD_WINDOWS.map((days) => Type.Literal(days))),
            ),
          }),
          response: {
            200: Type.Any(),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const days = (request.query.days ?? 7) as OpsDashboardWindow;
        const dashboard = await service.readDashboard({
          memberId,
          windowDays: days,
          requestId: request.id,
        });
        if (!dashboard) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(dashboard);
      },
    );

    opsApp.get<{
      Headers: OpsHeaders;
      Querystring: { limit?: number };
    }>(
      "/v1/internal/ops/ranking-preview",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          }),
          response: {
            200: Type.Any(),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const preview = await service.readRankingPreview({
          memberId,
          limit: request.query.limit ?? 50,
          requestId: request.id,
        });
        if (!preview) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(preview);
      },
    );

    opsApp.get<{
      Headers: OpsHeaders;
      Querystring: {
        status?: (typeof OPS_MEMBER_STATUSES)[number];
        q?: string;
        cursor?: string;
        limit?: number;
      };
    }>(
      "/v1/internal/ops/members",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          querystring: Type.Object({
            status: Type.Optional(
              Type.Union(OPS_MEMBER_STATUSES.map((status) => Type.Literal(status))),
            ),
            q: Type.Optional(Type.String({ maxLength: 80 })),
            cursor: Type.Optional(Type.String({ maxLength: 512 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          }),
          response: {
            200: Type.Any(),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const page = await service.readMembers({
          memberId,
          status: request.query.status,
          query: request.query.q,
          cursor: request.query.cursor,
          limit: request.query.limit ?? 25,
          requestId: request.id,
        });
        if (!page) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(page);
      },
    );

    opsApp.get<{
      Headers: OpsHeaders;
      Querystring: {
        status?: (typeof OPS_EDITORIAL_STATUSES)[number];
        scope?: (typeof OPS_EDITORIAL_SCOPES)[number];
        q?: string;
        cursor?: string;
        limit?: number;
      };
    }>(
      "/v1/internal/ops/editorial",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          querystring: Type.Object({
            status: Type.Optional(
              Type.Union(OPS_EDITORIAL_STATUSES.map((status) => Type.Literal(status))),
            ),
            scope: Type.Optional(
              Type.Union(OPS_EDITORIAL_SCOPES.map((scope) => Type.Literal(scope))),
            ),
            q: Type.Optional(Type.String({ maxLength: 120 })),
            cursor: Type.Optional(Type.String({ maxLength: 64 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          }),
          response: {
            200: Type.Any(),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const page = await service.readEditorial({
          memberId,
          status: request.query.status,
          scope: request.query.scope,
          query: request.query.q,
          cursor: request.query.cursor,
          limit: request.query.limit ?? 25,
          requestId: request.id,
        });
        if (!page) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(page);
      },
    );

    opsApp.put<{
      Headers: OpsHeaders;
      Params: { candidateId: string };
      Body: {
        expectedRevision: number;
        status: "APPROVED" | "NEEDS_CHANGES" | "REJECTED";
        note: string;
        checks: {
          binaryFit: boolean;
          choiceParity: boolean;
          duplicateReview: boolean;
          sourceReview: boolean;
        };
      };
    }>(
      "/v1/internal/ops/editorial/:candidateId/decision",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          params: Type.Object({ candidateId: Type.String({ minLength: 1, maxLength: 32 }) }),
          body: Type.Object({
            expectedRevision: Type.Integer({ minimum: 0 }),
            status: Type.Union([
              Type.Literal("APPROVED"),
              Type.Literal("NEEDS_CHANGES"),
              Type.Literal("REJECTED"),
            ]),
            note: Type.String({ maxLength: 2000 }),
            checks: Type.Object({
              binaryFit: Type.Boolean(),
              choiceParity: Type.Boolean(),
              duplicateReview: Type.Boolean(),
              sourceReview: Type.Boolean(),
            }),
          }),
          response: {
            200: Type.Any(),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            409: Type.Any(),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        if (
          request.body.status === "APPROVED" &&
          Object.values(request.body.checks).some((checked) => !checked)
        ) {
          return reply.code(400).send({
            code: "REVIEW_CHECKS_REQUIRED",
            message: "승인하려면 네 가지 편집 검수 항목을 모두 확인해야 합니다.",
          });
        }
        const decision = await service.saveEditorialDecision({
          memberId,
          candidateId: request.params.candidateId,
          ...request.body,
          requestId: request.id,
        });
        if (!decision) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(decision);
      },
    );

    opsApp.get<{ Headers: OpsHeaders }>(
      "/v1/internal/ops/point-shop",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          response: {
            200: Type.Any(),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const view = await service.readPointShop({ memberId, requestId: request.id });
        if (!view) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(view);
      },
    );

    opsApp.post<{
      Headers: OpsHeaders;
      Body: {
        code: string;
        equipSlot: (typeof OPS_POINT_SHOP_EQUIP_SLOTS)[number];
        themeFamily: (typeof OPS_POINT_SHOP_THEME_FAMILIES)[number];
        name: string;
        description: string;
        price: number;
        status: "ACTIVE" | "PAUSED";
        reason: string;
      };
    }>(
      "/v1/internal/ops/point-shop/items",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          body: Type.Object({
            code: Type.String({ minLength: 3, maxLength: 64, pattern: "^[A-Z0-9_]+$" }),
            equipSlot: Type.Union(OPS_POINT_SHOP_EQUIP_SLOTS.map((value) => Type.Literal(value))),
            themeFamily: Type.Union(
              OPS_POINT_SHOP_THEME_FAMILIES.map((value) => Type.Literal(value)),
            ),
            name: Type.String({ minLength: 2, maxLength: 80 }),
            description: Type.String({ minLength: 5, maxLength: 280 }),
            price: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
            status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED")]),
            reason: Type.String({ minLength: 8, maxLength: 500 }),
          }),
          response: {
            200: Type.Any(),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            409: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const item = await service.createPointShopItem({
          memberId,
          ...request.body,
          requestId: request.id,
        });
        if (!item) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(item);
      },
    );

    opsApp.patch<{
      Headers: OpsHeaders;
      Params: { itemId: string };
      Body: {
        expectedRevision: number;
        price: number;
        status: "ACTIVE" | "PAUSED";
        reason: string;
      };
    }>(
      "/v1/internal/ops/point-shop/items/:itemId",
      {
        schema: {
          hide: true,
          headers: opsHeadersSchema,
          params: Type.Object({ itemId: Type.String({ format: "uuid" }) }),
          body: Type.Object({
            expectedRevision: Type.Integer({ minimum: 1 }),
            price: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
            status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED")]),
            reason: Type.String({ minLength: 8, maxLength: 500 }),
          }),
          response: {
            200: Type.Any(),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            403: Type.Object({ code: Type.String(), message: Type.String() }),
            409: Type.Object({ code: Type.String(), message: Type.String() }),
            500: Type.Object({ code: Type.String(), message: Type.String() }),
          },
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const item = await service.updatePointShopItem({
          memberId,
          itemId: request.params.itemId,
          ...request.body,
          requestId: request.id,
        });
        if (!item) {
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "This Member does not have active OPERATOR access.",
          });
        }
        return reply.send(item);
      },
    );
  });
}
