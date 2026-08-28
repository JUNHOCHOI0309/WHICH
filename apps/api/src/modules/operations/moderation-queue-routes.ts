import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";
import { ModerationOperationsError } from "../moderation-operations/service.js";

import {
  OPS_MODERATION_QUEUE_LANES,
  type OpsModerationQueueService,
} from "./moderation-queue-contracts.js";

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

export async function registerOpsModerationQueueRoutes(
  app: FastifyInstance,
  service: OpsModerationQueueService,
  identity: MemberIdentityService,
  internalSecret: string,
) {
  await app.register((queueApp) => {
    async function authenticate(
      request: FastifyRequest<{ Headers: Headers }>,
      reply: FastifyReply,
    ) {
      if (!sameSecret(request.headers["x-internal-auth-secret"], internalSecret)) {
        await reply.code(401).send({ code: "UNAUTHORIZED", message: "Internal auth failed." });
        return null;
      }
      const token = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice(7).trim()
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

    queueApp.setErrorHandler((error, request, reply) => {
      if (error instanceof ModerationOperationsError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "OPS_MODERATION_QUEUE_FAILED",
        message: "운영 예외 Queue 요청을 처리하지 못했습니다.",
      });
    });

    queueApp.get<{
      Headers: Headers;
      Querystring: { lane?: (typeof OPS_MODERATION_QUEUE_LANES)[number]; limit?: number };
    }>(
      "/v1/internal/ops/moderation-queue",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          querystring: Type.Object({
            lane: Type.Optional(
              Type.Union(OPS_MODERATION_QUEUE_LANES.map((lane) => Type.Literal(lane))),
            ),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const result = await service.readQueue({
          memberId,
          lane: request.query.lane,
          limit: request.query.limit ?? 25,
          requestId: request.id,
        });
        if (!result)
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "Active OPERATOR access is required.",
          });
        return reply.send(result);
      },
    );

    queueApp.post<{
      Headers: Headers;
      Params: { caseId: string };
      Body: { eventType: "CASE_VIEWED" | "ASSET_REVEALED" | "ORIGINAL_VIEWED" };
    }>(
      "/v1/internal/ops/moderation-queue/:caseId/views",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          params: Type.Object({ caseId: Type.String({ format: "uuid" }) }),
          body: Type.Object({
            eventType: Type.Union([
              Type.Literal("CASE_VIEWED"),
              Type.Literal("ASSET_REVEALED"),
              Type.Literal("ORIGINAL_VIEWED"),
            ]),
          }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        const allowed = await service.recordView({
          memberId,
          caseId: request.params.caseId,
          eventType: request.body.eventType,
          requestId: request.id,
        });
        if (!allowed)
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "Active OPERATOR access is required.",
          });
        return reply.code(204).send();
      },
    );

    queueApp.put<{
      Headers: Headers;
      Params: { caseId: string };
      Body: {
        expectedRevision: number;
        action:
          | "APPROVED"
          | "REJECTED"
          | "HIDDEN"
          | "RESTORED"
          | "DELETED"
          | "COLLAPSE"
          | "HIDE"
          | "REMOVE_POLICY"
          | "RESTORE";
        reasonCode: string;
        rationale: string;
        policyVersion: string;
      };
    }>(
      "/v1/internal/ops/moderation-queue/:caseId/decision",
      {
        schema: {
          hide: true,
          headers: headersSchema,
          params: Type.Object({ caseId: Type.String({ format: "uuid" }) }),
          body: Type.Object({
            expectedRevision: Type.Integer({ minimum: 1 }),
            action: Type.Union([
              Type.Literal("APPROVED"),
              Type.Literal("REJECTED"),
              Type.Literal("HIDDEN"),
              Type.Literal("RESTORED"),
              Type.Literal("DELETED"),
              Type.Literal("COLLAPSE"),
              Type.Literal("HIDE"),
              Type.Literal("REMOVE_POLICY"),
              Type.Literal("RESTORE"),
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
        const result = await service.decide({
          memberId,
          caseId: request.params.caseId,
          decision: request.body,
          requestId: request.id,
        });
        if (!result)
          return reply.code(403).send({
            code: "OPERATOR_ROLE_REQUIRED",
            message: "Active OPERATOR access is required.",
          });
        return reply.send(result);
      },
    );
  });
}
