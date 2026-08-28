import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { ContentRevisionService } from "./contracts.js";
import { ContentRevisionError } from "./service.js";

function secretsMatch(actual: string | undefined, expected: string) {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registerContentRevisionRoutes(
  app: FastifyInstance,
  service: ContentRevisionService,
  moderationInternalSecret: string,
) {
  app.post<{
    Headers: { "x-moderation-auth-secret"?: string };
    Body: {
      targetType: "COMMENT_REVISION" | "ISSUE_VERSION" | "MEDIA_ASSET_VERSION";
      targetId: string;
      targetVersion: number;
      policyVersion: string;
      inputHash: string;
      normalizedSnapshotRef: string;
      ocrTranscriptRef?: string;
      reason:
        "CREATE" | "EDIT" | "REPLACEMENT" | "POLICY_CHANGE" | "APPEAL" | "RIGHTS" | "BACKFILL";
    };
  }>(
    "/v1/internal/moderation/rechecks",
    {
      schema: {
        tags: ["moderation"],
        headers: Type.Object({
          "x-moderation-auth-secret": Type.Optional(Type.String()),
        }),
        body: Type.Object({
          targetType: Type.Union([
            Type.Literal("COMMENT_REVISION"),
            Type.Literal("ISSUE_VERSION"),
            Type.Literal("MEDIA_ASSET_VERSION"),
          ]),
          targetId: Type.String({ format: "uuid" }),
          targetVersion: Type.Integer({ minimum: 1 }),
          policyVersion: Type.String({ minLength: 1, maxLength: 64 }),
          inputHash: Type.String({ minLength: 64, maxLength: 64 }),
          normalizedSnapshotRef: Type.String({ minLength: 1, maxLength: 512 }),
          ocrTranscriptRef: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
          reason: Type.Union([
            Type.Literal("CREATE"),
            Type.Literal("EDIT"),
            Type.Literal("REPLACEMENT"),
            Type.Literal("POLICY_CHANGE"),
            Type.Literal("APPEAL"),
            Type.Literal("RIGHTS"),
            Type.Literal("BACKFILL"),
          ]),
        }),
      },
    },
    async (request, reply) => {
      if (!secretsMatch(request.headers["x-moderation-auth-secret"], moderationInternalSecret)) {
        return reply.code(401).send({ code: "UNAUTHORIZED" });
      }
      try {
        const result = await service.requestModerationRecheck(request.body);
        return reply.code(result.created ? 201 : 200).send(result);
      } catch (error) {
        if (error instanceof ContentRevisionError) {
          return reply.code(error.statusCode).send({ code: error.code, message: error.message });
        }
        throw error;
      }
    },
  );
}
