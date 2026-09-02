import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";

import {
  PointIntegrityError,
  type PointIntegrityService,
  type PointReconciliationReport,
  type PointReversalReport,
} from "./integrity.js";

const headersSchema = Type.Object(
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

export async function registerPointOpsRoutes(
  app: FastifyInstance,
  service: PointIntegrityService,
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
      if (error instanceof PointIntegrityError) {
        const status =
          error.code === "OPERATOR_ROLE_REQUIRED"
            ? 403
            : error.code === "INVALID_ADJUSTMENT"
              ? 400
              : 409;
        return reply.code(status).send({ code: error.code, message: error.message });
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "validation" in error &&
        error.validation
      ) {
        return reply
          .code(400)
          .send({ code: "INVALID_REQUEST", message: "Invalid point operations request." });
      }
      request.log.error(error);
      return reply
        .code(500)
        .send({ code: "POINT_OPS_FAILED", message: "The point operation failed." });
    });

    opsApp.get<{
      Headers: OpsHeaders;
      Querystring: {
        memberId?: string;
        sourceEventId?: string;
        sourceType?: string;
        from?: string;
        to?: string;
        limit?: number;
      };
    }>(
      "/v1/internal/ops/points/ledger",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          querystring: Type.Object({
            memberId: Type.Optional(Type.String({ format: "uuid" })),
            sourceEventId: Type.Optional(Type.String({ format: "uuid" })),
            sourceType: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
            from: Type.Optional(Type.String({ format: "date-time" })),
            to: Type.Optional(Type.String({ format: "date-time" })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
          }),
          response: {
            200: Type.Any(),
            400: Type.Any(),
            401: Type.Any(),
            403: Type.Any(),
            409: Type.Any(),
          },
        },
      },
      async (request, reply) => {
        const operatorMemberId = await authenticate(request, reply);
        if (!operatorMemberId) return;
        return reply.send(
          await service.listLedger({
            operatorMemberId,
            ...request.query,
            requestId: request.id,
          }),
        );
      },
    );

    opsApp.get<{
      Headers: OpsHeaders;
      Querystring: { memberId?: string };
    }>(
      "/v1/internal/ops/points/reconciliation",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          querystring: Type.Object({
            memberId: Type.Optional(Type.String({ format: "uuid" })),
          }),
          response: { 200: Type.Any(), 401: Type.Any(), 403: Type.Any() },
        },
      },
      async (request, reply) => {
        const operatorMemberId = await authenticate(request, reply);
        if (!operatorMemberId) return;
        return reply.send(
          await service.reconcile({
            operatorMemberId,
            memberId: request.query.memberId,
            requestId: request.id,
          }),
        );
      },
    );

    opsApp.post<{
      Headers: OpsHeaders;
      Body: { report: PointReconciliationReport; confirm: string };
    }>(
      "/v1/internal/ops/points/reconciliation/repair",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          body: Type.Object({ report: Type.Any(), confirm: Type.String({ minLength: 1 }) }),
          response: {
            200: Type.Any(),
            400: Type.Any(),
            401: Type.Any(),
            403: Type.Any(),
            409: Type.Any(),
          },
        },
      },
      async (request, reply) => {
        const operatorMemberId = await authenticate(request, reply);
        if (!operatorMemberId) return;
        return reply.send(
          await service.repair({ operatorMemberId, ...request.body, requestId: request.id }),
        );
      },
    );

    opsApp.get<{ Headers: OpsHeaders }>(
      "/v1/internal/ops/points/reversals",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          response: { 200: Type.Any(), 401: Type.Any(), 403: Type.Any() },
        },
      },
      async (request, reply) => {
        const operatorMemberId = await authenticate(request, reply);
        if (!operatorMemberId) return;
        return reply.send(
          await service.planInvalidatedVoteReversals({
            operatorMemberId,
            requestId: request.id,
          }),
        );
      },
    );

    opsApp.post<{
      Headers: OpsHeaders;
      Body: { report: PointReversalReport; confirm: string };
    }>(
      "/v1/internal/ops/points/reversals",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          body: Type.Object({ report: Type.Any(), confirm: Type.String({ minLength: 1 }) }),
          response: { 200: Type.Any(), 400: Type.Any(), 401: Type.Any(), 403: Type.Any() },
        },
      },
      async (request, reply) => {
        const operatorMemberId = await authenticate(request, reply);
        if (!operatorMemberId) return;
        return reply.send(
          await service.applyInvalidatedVoteReversals({
            operatorMemberId,
            ...request.body,
            requestId: request.id,
          }),
        );
      },
    );

    opsApp.post<{
      Headers: OpsHeaders;
      Body: {
        targetMemberId: string;
        amount: number;
        reason: string;
        incidentId: string;
        idempotencyKey: string;
      };
    }>(
      "/v1/internal/ops/points/adjustments",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          body: Type.Object({
            targetMemberId: Type.String({ format: "uuid" }),
            amount: Type.Integer(),
            reason: Type.String({ minLength: 1 }),
            incidentId: Type.String({ minLength: 3, maxLength: 128 }),
            idempotencyKey: Type.String({ minLength: 8, maxLength: 160 }),
          }),
          response: { 200: Type.Any(), 400: Type.Any(), 401: Type.Any(), 403: Type.Any() },
        },
      },
      async (request, reply) => {
        const operatorMemberId = await authenticate(request, reply);
        if (!operatorMemberId) return;
        return reply.send(
          await service.adjust({ operatorMemberId, ...request.body, requestId: request.id }),
        );
      },
    );
  });
}
