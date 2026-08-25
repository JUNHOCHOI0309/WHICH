import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { MemberIdentityService } from "../identity/contracts.js";

import {
  OPS_DASHBOARD_WINDOWS,
  type OpsDashboardService,
  type OpsDashboardWindow,
} from "./contracts.js";

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
    opsApp.setErrorHandler((error, request, reply) => {
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

    opsApp.get<{
      Headers: { authorization?: string; "x-internal-auth-secret"?: string };
      Querystring: { days?: number };
    }>(
      "/v1/internal/ops/dashboard",
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
        if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
          return reply
            .code(401)
            .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        }
        const token = bearerToken(request.headers.authorization);
        const session = token ? await identity.getSession(token) : null;
        if (!session) {
          return reply
            .code(401)
            .send({ code: "SESSION_INVALID", message: "A valid Member session is required." });
        }
        const days = (request.query.days ?? 7) as OpsDashboardWindow;
        const dashboard = await service.readDashboard({
          memberId: session.member.id,
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
  });
}
