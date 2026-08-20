import { timingSafeEqual } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import type { GuestVoteService } from "./contracts.js";
import { GuestVoteError } from "./errors.js";

const uuidSchema = Type.String({ format: "uuid" });

const guestSubjectSchema = Type.Object({
  anonymousSubjectId: uuidSchema,
});

const resultSchema = Type.Object({
  resultVersion: Type.Integer({ minimum: 1 }),
  acceptedA: Type.Integer({ minimum: 0 }),
  acceptedB: Type.Integer({ minimum: 0 }),
  displayedTotal: Type.Integer({ minimum: 0 }),
  integrityState: Type.Union([
    Type.Literal("NORMAL"),
    Type.Literal("MONITORING"),
    Type.Literal("DEGRADED"),
    Type.Literal("UNDER_REVIEW"),
    Type.Literal("RESULT_LOCKED"),
    Type.Literal("CORRECTED"),
  ]),
});

const voteResponseSchema = Type.Object({
  outcome: Type.Union([Type.Literal("ACCEPTED"), Type.Literal("REJECTED_DUPLICATE")]),
  voteAttemptId: uuidSchema,
  voteId: uuidSchema,
  issueId: uuidSchema,
  issueVersion: Type.Integer({ minimum: 1 }),
  choice: Type.Union([Type.Literal("A"), Type.Literal("B")]),
  result: resultSchema,
});

const errorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
});

const reconciliationValueSchema = Type.Union([
  Type.Integer(),
  Type.String(),
  Type.Boolean(),
  Type.Null(),
]);
const ledgerCountsSchema = Type.Object({
  voteRequestCount: Type.Integer({ minimum: 0 }),
  acceptedACount: Type.Integer({ minimum: 0 }),
  acceptedBCount: Type.Integer({ minimum: 0 }),
  acceptedVoteCount: Type.Integer({ minimum: 0 }),
  reviewVoteCount: Type.Integer({ minimum: 0 }),
  rejectedDuplicateCount: Type.Integer({ minimum: 0 }),
  rejectedAbuseCount: Type.Integer({ minimum: 0 }),
  invalidatedVoteCount: Type.Integer({ minimum: 0 }),
  displayedVoteCount: Type.Integer({ minimum: 0 }),
});
const aggregateViewSchema = Type.Intersect([
  ledgerCountsSchema,
  Type.Object({
    resultVersion: Type.Integer({ minimum: 1 }),
    integrityState: resultSchema.properties.integrityState,
  }),
]);
const snapshotViewSchema = Type.Object({
  resultVersion: Type.Integer({ minimum: 1 }),
  acceptedACount: Type.Integer({ minimum: 0 }),
  acceptedBCount: Type.Integer({ minimum: 0 }),
  displayedVoteCount: Type.Integer({ minimum: 0 }),
  integrityState: resultSchema.properties.integrityState,
});
const reconciliationResponseSchema = Type.Object({
  issueId: uuidSchema,
  issueVersion: Type.Integer({ minimum: 1 }),
  mode: Type.Union([Type.Literal("DRY_RUN"), Type.Literal("REPAIR")]),
  status: Type.Union([
    Type.Literal("CONSISTENT"),
    Type.Literal("MISMATCH_FOUND"),
    Type.Literal("REPAIRED"),
    Type.Literal("RESULT_LOCKED"),
  ]),
  checkedAt: Type.String({ format: "date-time" }),
  source: ledgerCountsSchema,
  aggregateBefore: Type.Union([aggregateViewSchema, Type.Null()]),
  latestSnapshotBefore: Type.Union([snapshotViewSchema, Type.Null()]),
  mismatches: Type.Array(
    Type.Object({
      target: Type.Union([
        Type.Literal("SOURCE"),
        Type.Literal("AGGREGATE"),
        Type.Literal("LATEST_SNAPSHOT"),
      ]),
      field: Type.String(),
      expected: reconciliationValueSchema,
      actual: reconciliationValueSchema,
    }),
  ),
  resultAfter: Type.Union([aggregateViewSchema, Type.Null()]),
});

type VoteRoute = {
  Params: { issueId: string };
  Headers: {
    "idempotency-key": string;
    "x-anonymous-subject-id": string;
    "x-analytics-session-id"?: string;
  };
  Body: { issueVersion: number; choiceId: string };
};

type ReconciliationRoute = {
  Params: { issueId: string; issueVersion: number };
  Headers: { "x-internal-auth-secret"?: string };
  Body: { mode?: "DRY_RUN" | "REPAIR" };
};

function secretMatches(provided: string | undefined, expected: string) {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export async function registerVotingRoutes(
  app: FastifyInstance,
  service: GuestVoteService,
  internalSecret: string,
) {
  await app.register((votingApp) => {
    votingApp.setErrorHandler((error, request, reply) => {
      if (error instanceof GuestVoteError) {
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
          message: "The vote request does not match the API contract.",
        });
      }

      request.log.error(error);
      return reply.code(500).send({
        code: "INTERNAL_ERROR",
        message: "The vote request could not be completed.",
      });
    });

    votingApp.post(
      "/v1/guest-subjects",
      {
        schema: {
          tags: ["voting"],
          summary: "Create a first-party Guest voting subject",
          response: {
            201: guestSubjectSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (_request, reply) => {
        const subject = await service.createGuestSubject();
        return reply.code(201).send(subject);
      },
    );

    votingApp.post<VoteRoute>(
      "/v1/issues/:issueId/votes",
      {
        schema: {
          tags: ["voting"],
          summary: "Submit an idempotent Guest vote",
          params: Type.Object({ issueId: uuidSchema }),
          headers: Type.Object(
            {
              "idempotency-key": uuidSchema,
              "x-anonymous-subject-id": uuidSchema,
              "x-analytics-session-id": Type.Optional(uuidSchema),
            },
            { additionalProperties: true },
          ),
          body: Type.Object({
            issueVersion: Type.Integer({ minimum: 1 }),
            choiceId: uuidSchema,
          }),
          response: {
            201: voteResponseSchema,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: Type.Union([voteResponseSchema, errorResponseSchema]),
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const result = await service.submitGuestVote({
          idempotencyKey: request.headers["idempotency-key"],
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          issueId: request.params.issueId,
          issueVersion: request.body.issueVersion,
          choiceId: request.body.choiceId,
          analyticsSessionId: request.headers["x-analytics-session-id"],
        });

        return reply.code(result.httpStatus).send(result.body);
      },
    );

    votingApp.post<ReconciliationRoute>(
      "/v1/internal/issues/:issueId/versions/:issueVersion/vote-reconciliation",
      {
        schema: {
          hide: true,
          params: Type.Object({
            issueId: uuidSchema,
            issueVersion: Type.Integer({ minimum: 1 }),
          }),
          headers: Type.Object(
            { "x-internal-auth-secret": Type.Optional(Type.String()) },
            { additionalProperties: true },
          ),
          body: Type.Object({
            mode: Type.Optional(
              Type.Union([Type.Literal("DRY_RUN"), Type.Literal("REPAIR")], {
                default: "DRY_RUN",
              }),
            ),
          }),
          response: {
            200: reconciliationResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            404: errorResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        if (!secretMatches(request.headers["x-internal-auth-secret"], internalSecret)) {
          return reply
            .code(401)
            .send({ code: "UNAUTHORIZED", message: "Internal authentication failed." });
        }
        return service.reconcileIssueVersion({
          issueId: request.params.issueId,
          issueVersion: request.params.issueVersion,
          mode: request.body.mode ?? "DRY_RUN",
        });
      },
    );
  });
}
