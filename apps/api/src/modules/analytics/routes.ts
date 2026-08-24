import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import {
  ANALYTICS_AUDIENCE_SEGMENTS,
  ANALYTICS_DEVICE_SEGMENTS,
  ANALYTICS_ENTRY_SURFACES,
  ANALYTICS_EVENT_TYPES,
  ANALYTICS_TRAFFIC_CLASSES,
  type AnalyticsService,
} from "./contracts.js";
import { AnalyticsEventError } from "./service.js";

const uuidSchema = Type.String({ format: "uuid" });
const attributionSchema = Type.Union([
  Type.Object({
    source: Type.Literal("naver"),
    medium: Type.Union([
      Type.Literal("choice"),
      Type.Literal("cafe"),
      Type.Literal("clip_blog"),
      Type.Literal("blog_search"),
      Type.Literal("homefeed_da"),
      Type.Literal("lounge"),
      Type.Literal("band"),
    ]),
    campaign: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    content: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
    capturedAt: Type.String({ format: "date-time" }),
  }),
  Type.Object({
    source: Type.Literal("share"),
    medium: Type.Union([Type.Literal("copy"), Type.Literal("system"), Type.Literal("x")]),
    campaign: Type.Union([Type.Literal("result"), Type.Literal("result_with_choice")]),
    content: uuidSchema,
    capturedAt: Type.String({ format: "date-time" }),
  }),
]);

function secretMatches(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  service: AnalyticsService,
  internalSecret: string,
) {
  await app.register((analyticsApp) => {
    analyticsApp.setErrorHandler((error, request, reply) => {
      if (error instanceof AnalyticsEventError) {
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
          message: "The analytics event does not match the contract.",
        });
      }
      request.log.error(error);
      return reply
        .code(500)
        .send({ code: "INTERNAL_ERROR", message: "The analytics event could not be stored." });
    });

    analyticsApp.post<{
      Headers: { "x-internal-auth-secret"?: string };
      Body: Parameters<AnalyticsService["recordEvent"]>[0];
    }>(
      "/v1/internal/analytics/events",
      {
        schema: {
          hide: true,
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            eventId: uuidSchema,
            sessionId: uuidSchema,
            eventType: Type.Union(
              ANALYTICS_EVENT_TYPES.map((eventType) => Type.Literal(eventType)),
            ),
            issueId: uuidSchema,
            issueVersion: Type.Integer({ minimum: 1 }),
            recommendationRequestId: Type.Optional(uuidSchema),
            shareCardId: Type.Optional(uuidSchema),
            occurredAt: Type.String({ format: "date-time" }),
            attribution: Type.Optional(attributionSchema),
            context: Type.Optional(
              Type.Object({
                entrySurface: Type.Union(
                  ANALYTICS_ENTRY_SURFACES.map((value) => Type.Literal(value)),
                ),
                audienceSegment: Type.Union(
                  ANALYTICS_AUDIENCE_SEGMENTS.map((value) => Type.Literal(value)),
                ),
                deviceSegment: Type.Union(
                  ANALYTICS_DEVICE_SEGMENTS.map((value) => Type.Literal(value)),
                ),
                trafficClass: Type.Union(
                  ANALYTICS_TRAFFIC_CLASSES.map((value) => Type.Literal(value)),
                ),
              }),
            ),
          }),
          response: {
            200: Type.Object({ accepted: Type.Literal(true), duplicate: Type.Boolean() }),
            400: Type.Object({ code: Type.String(), message: Type.String() }),
            401: Type.Object({ code: Type.String(), message: Type.String() }),
            404: Type.Object({ code: Type.String(), message: Type.String() }),
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
        return reply.send(await service.recordEvent(request.body));
      },
    );
  });
}
