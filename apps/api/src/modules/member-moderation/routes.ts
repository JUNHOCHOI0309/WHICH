import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";

import { MEMBER_MODERATION_TARGET_TYPES, type MemberModerationService } from "./contracts.js";
import { MemberModerationError } from "./service.js";

const headersSchema = Type.Object(
  { authorization: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
const targetTypeSchema = Type.Union(
  MEMBER_MODERATION_TARGET_TYPES.map((value) => Type.Literal(value)),
);
const evidenceSchema = Type.Optional(Type.Record(Type.String(), Type.Unknown()));
const noticeIdsSchema = Type.Array(Type.String({ format: "uuid" }), {
  minItems: 1,
  maxItems: 30,
  uniqueItems: true,
});
type Headers = { authorization?: string };

export async function registerMemberModerationRoutes(
  app: FastifyInstance,
  service: MemberModerationService,
  identity: MemberIdentityService,
) {
  await app.register((memberApp) => {
    async function authenticate(
      request: FastifyRequest<{ Headers: Headers }>,
      reply: FastifyReply,
    ) {
      const token = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice(7).trim()
        : "";
      const session = token ? await identity.getSession(token) : null;
      if (!session) {
        await reply.code(401).send({ code: "SESSION_INVALID", message: "로그인이 필요합니다." });
        return null;
      }
      return session.member.id;
    }

    memberApp.setErrorHandler((error, request, reply) => {
      if (error instanceof MemberModerationError) {
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
          message: "Moderation 요청 내용을 다시 확인해 주세요.",
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        code: "MEMBER_MODERATION_FAILED",
        message: "Moderation 요청을 처리하지 못했습니다.",
      });
    });

    memberApp.get<{ Headers: Headers }>(
      "/v1/me/moderation",
      { schema: { tags: ["identity"], headers: headersSchema } },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        return reply.send(await service.readCenter(memberId));
      },
    );

    memberApp.get<{ Headers: Headers }>(
      "/v1/me/notifications",
      { schema: { tags: ["identity"], headers: headersSchema } },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        return reply.send(await service.readNotifications(memberId));
      },
    );

    memberApp.patch<{
      Headers: Headers;
      Body: { noticeIds: string[] };
    }>(
      "/v1/me/notifications",
      {
        schema: {
          tags: ["identity"],
          headers: headersSchema,
          body: Type.Object({ noticeIds: noticeIdsSchema }, { additionalProperties: false }),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        return reply.send(await service.markNotificationsRead(memberId, request.body.noticeIds));
      },
    );

    memberApp.post<{
      Headers: Headers;
      Body: {
        targetType: (typeof MEMBER_MODERATION_TARGET_TYPES)[number];
        targetId: string;
        reason: string;
        evidence?: Record<string, unknown>;
      };
    }>(
      "/v1/me/moderation/appeals",
      {
        schema: {
          tags: ["identity"],
          headers: headersSchema,
          body: Type.Object(
            {
              targetType: targetTypeSchema,
              targetId: Type.String({ format: "uuid" }),
              reason: Type.String({ minLength: 20, maxLength: 4000 }),
              evidence: evidenceSchema,
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        return reply.code(201).send(await service.createAppeal({ memberId, ...request.body }));
      },
    );

    memberApp.post<{
      Headers: Headers;
      Body: {
        requestType: "PRIVACY" | "DEFAMATION" | "COPYRIGHT";
        targetType: (typeof MEMBER_MODERATION_TARGET_TYPES)[number];
        targetId: string;
        details: string;
        evidence?: Record<string, unknown>;
      };
    }>(
      "/v1/me/moderation/rights",
      {
        schema: {
          tags: ["identity"],
          headers: headersSchema,
          body: Type.Object(
            {
              requestType: Type.Union([
                Type.Literal("PRIVACY"),
                Type.Literal("DEFAMATION"),
                Type.Literal("COPYRIGHT"),
              ]),
              targetType: targetTypeSchema,
              targetId: Type.String({ format: "uuid" }),
              details: Type.String({ minLength: 20, maxLength: 4000 }),
              evidence: evidenceSchema,
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        return reply.code(201).send(await service.createRightsCase({ memberId, ...request.body }));
      },
    );

    memberApp.post<{
      Headers: Headers;
      Params: { submissionId: string };
      Body: {
        action: "TEXT_ONLY" | "APPROVED_LIBRARY" | "REPLACE_IMAGE" | "CANCEL_IMAGE";
        replacementAssetAId?: string;
        replacementAssetBId?: string;
      };
    }>(
      "/v1/me/moderation/submissions/:submissionId/asset-alternative",
      {
        schema: {
          tags: ["identity"],
          headers: headersSchema,
          params: Type.Object({ submissionId: Type.String({ format: "uuid" }) }),
          body: Type.Object(
            {
              action: Type.Union([
                Type.Literal("TEXT_ONLY"),
                Type.Literal("APPROVED_LIBRARY"),
                Type.Literal("REPLACE_IMAGE"),
                Type.Literal("CANCEL_IMAGE"),
              ]),
              replacementAssetAId: Type.Optional(Type.String({ format: "uuid" })),
              replacementAssetBId: Type.Optional(Type.String({ format: "uuid" })),
            },
            { additionalProperties: false },
          ),
        },
      },
      async (request, reply) => {
        const memberId = await authenticate(request, reply);
        if (!memberId) return;
        return reply.send(
          await service.chooseAssetAlternative({
            memberId,
            submissionId: request.params.submissionId,
            ...request.body,
          }),
        );
      },
    );
  });
}
