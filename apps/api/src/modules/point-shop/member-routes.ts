import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";
import type { PointShopEquipSlot, PointShopService } from "./contracts.js";
import { isPointShopEquipSlot, PointShopError } from "./service.js";

const authHeaders = Type.Object(
  { authorization: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
const errorSchema = Type.Object({ code: Type.String(), message: Type.String() });

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function registerPointShopMemberRoutes(
  app: FastifyInstance,
  service: PointShopService,
  identity: MemberIdentityService,
) {
  await app.register((shopApp) => {
    shopApp.setErrorHandler((error, request, reply) => {
      if (error instanceof PointShopError) {
        const status =
          error.code === "SHOP_ITEM_NOT_FOUND"
            ? 404
            : error.code === "SHOP_INSUFFICIENT_BALANCE"
              ? 422
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
          .send({ code: "INVALID_REQUEST", message: "잘못된 상점 요청입니다." });
      }
      request.log.error(error);
      return reply
        .code(500)
        .send({ code: "POINT_SHOP_FAILED", message: "상점 요청에 실패했습니다." });
    });

    async function memberId(authorization: string | undefined) {
      const token = bearerToken(authorization);
      const session = token ? await identity.getSession(token) : null;
      return session?.member.id ?? null;
    }

    shopApp.get<{ Headers: { authorization?: string } }>(
      "/v1/me/point-shop",
      {
        schema: {
          tags: ["points"],
          headers: authHeaders,
          response: { 200: Type.Any(), 401: errorSchema },
        },
      },
      async (request, reply) => {
        const id = await memberId(request.headers.authorization);
        if (!id)
          return reply.code(401).send({ code: "SESSION_INVALID", message: "로그인이 필요합니다." });
        return service.listShop(id);
      },
    );

    shopApp.post<{
      Headers: { authorization?: string };
      Body: { itemId: string; idempotencyKey: string };
    }>(
      "/v1/me/point-shop/purchases",
      {
        schema: {
          tags: ["points"],
          headers: authHeaders,
          body: Type.Object({
            itemId: Type.String({ format: "uuid" }),
            idempotencyKey: Type.String({ minLength: 8, maxLength: 96 }),
          }),
          response: {
            200: Type.Any(),
            400: errorSchema,
            401: errorSchema,
            409: errorSchema,
            422: errorSchema,
          },
        },
      },
      async (request, reply) => {
        const id = await memberId(request.headers.authorization);
        if (!id)
          return reply.code(401).send({ code: "SESSION_INVALID", message: "로그인이 필요합니다." });
        return service.purchase({ memberId: id, ...request.body });
      },
    );

    shopApp.put<{
      Headers: { authorization?: string };
      Params: { equipSlot: string };
      Body: { itemId: string };
    }>(
      "/v1/me/point-shop/equipment/:equipSlot",
      {
        schema: {
          tags: ["points"],
          headers: authHeaders,
          params: Type.Object({ equipSlot: Type.String() }),
          body: Type.Object({ itemId: Type.String({ format: "uuid" }) }),
          response: { 200: Type.Any(), 400: errorSchema, 401: errorSchema, 409: errorSchema },
        },
      },
      async (request, reply) => {
        const id = await memberId(request.headers.authorization);
        if (!id)
          return reply.code(401).send({ code: "SESSION_INVALID", message: "로그인이 필요합니다." });
        if (!isPointShopEquipSlot(request.params.equipSlot)) {
          return reply
            .code(400)
            .send({ code: "INVALID_EQUIP_SLOT", message: "지원하지 않는 장착 위치입니다." });
        }
        return service.equip({
          memberId: id,
          equipSlot: request.params.equipSlot,
          itemId: request.body.itemId,
        });
      },
    );

    shopApp.delete<{
      Headers: { authorization?: string };
      Params: { equipSlot: PointShopEquipSlot };
    }>(
      "/v1/me/point-shop/equipment/:equipSlot",
      {
        schema: {
          tags: ["points"],
          headers: authHeaders,
          params: Type.Object({ equipSlot: Type.String() }),
          response: { 200: Type.Any(), 400: errorSchema, 401: errorSchema },
        },
      },
      async (request, reply) => {
        const id = await memberId(request.headers.authorization);
        if (!id)
          return reply.code(401).send({ code: "SESSION_INVALID", message: "로그인이 필요합니다." });
        if (!isPointShopEquipSlot(request.params.equipSlot)) {
          return reply
            .code(400)
            .send({ code: "INVALID_EQUIP_SLOT", message: "지원하지 않는 장착 위치입니다." });
        }
        return service.unequip({ memberId: id, equipSlot: request.params.equipSlot });
      },
    );
  });
}
