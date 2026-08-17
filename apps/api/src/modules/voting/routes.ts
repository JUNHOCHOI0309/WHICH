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

type VoteRoute = {
  Params: { issueId: string };
  Headers: { "idempotency-key": string; "x-anonymous-subject-id": string };
  Body: { issueVersion: number; choiceId: string };
};

export async function registerVotingRoutes(app: FastifyInstance, service: GuestVoteService) {
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
        });

        return reply.code(result.httpStatus).send(result.body);
      },
    );
  });
}
