import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";
import type { MemberPointService } from "./member-contracts.js";

const errorSchema = Type.Object({ code: Type.String(), message: Type.String() });

const pointViewSchema = Type.Object({
  account: Type.Object({
    balance: Type.Integer({ minimum: 0 }),
    todayEarned: Type.Integer({ minimum: 0 }),
    lifetimeEarned: Type.Integer({ minimum: 0 }),
    lifetimeSpent: Type.Integer({ minimum: 0 }),
    hasPendingRecovery: Type.Boolean(),
  }),
  ledger: Type.Object({
    items: Type.Array(
      Type.Object({
        id: Type.String({ format: "uuid" }),
        entryType: Type.Union([
          Type.Literal("EARN"),
          Type.Literal("SPEND"),
          Type.Literal("REFUND"),
          Type.Literal("REVERSAL"),
          Type.Literal("ADJUSTMENT"),
        ]),
        amount: Type.Integer(),
        reasonCode: Type.String(),
        reasonLabel: Type.String(),
        createdAt: Type.String({ format: "date-time" }),
      }),
    ),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  }),
});

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function decodeCursor(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      entryId?: unknown;
    };
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    if (
      !createdAt ||
      Number.isNaN(createdAt.getTime()) ||
      typeof parsed.entryId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.entryId,
      )
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt, entryId: parsed.entryId };
  } catch {
    return null;
  }
}

export function registerMemberPointRoutes(
  app: FastifyInstance,
  service: MemberPointService,
  memberIdentity: MemberIdentityService,
) {
  app.get<{
    Headers: { authorization?: string };
    Querystring: { limit?: number; cursor?: string };
  }>(
    "/v1/me/points",
    {
      schema: {
        tags: ["points"],
        summary: "Read the current Member W Point balance and ledger",
        headers: Type.Object(
          { authorization: Type.Optional(Type.String()) },
          { additionalProperties: true },
        ),
        querystring: Type.Object({
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
        }),
        response: { 200: pointViewSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      const session = token ? await memberIdentity.getSession(token) : null;
      if (!session) {
        return reply.code(401).send({
          code: "SESSION_INVALID",
          message: "The Member session is invalid or expired.",
        });
      }
      const cursor = decodeCursor(request.query.cursor);
      if (cursor === null) {
        return reply.code(400).send({
          code: "INVALID_CURSOR",
          message: "The point ledger cursor is invalid.",
        });
      }
      return service.getMemberPoints(session.member.id, {
        limit: request.query.limit ?? 10,
        cursor,
      });
    },
  );
}
