import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import { INTEREST_CARD_CODES, type InterestProfileService } from "./contracts.js";
import { InterestProfileError } from "./errors.js";

const uuidSchema = Type.String({ format: "uuid" });
const cardCodeSchema = Type.Union(INTEREST_CARD_CODES.map((code) => Type.Literal(code)));
const identityHeaders = Type.Object(
  {
    authorization: Type.Optional(Type.String()),
    "x-anonymous-subject-id": Type.Optional(uuidSchema),
  },
  { additionalProperties: true },
);
const errorSchema = Type.Object({ code: Type.String(), message: Type.String() });
const mergeCandidateSchema = Type.Union([
  Type.Null(),
  Type.Object({
    anonymousSubjectId: uuidSchema,
    guestCardCodes: Type.Array(cardCodeSchema),
    suggestedCardCodes: Type.Array(cardCodeSchema),
  }),
]);
const profileSchema = Type.Object({
  taxonomyVersion: Type.Literal("interest_cards_v1"),
  onboardingState: Type.Union([
    Type.Literal("NOT_STARTED"),
    Type.Literal("COMPLETED"),
    Type.Literal("SKIPPED"),
    Type.Literal("RESET"),
  ]),
  selectedCardCodes: Type.Array(cardCodeSchema),
  canSkip: Type.Boolean(),
  profileVersion: Type.Integer({ minimum: 1 }),
  mergeCandidate: mergeCandidateSchema,
});

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function registerInterestRoutes(
  app: FastifyInstance,
  service: InterestProfileService,
) {
  await app.register((interestApp) => {
    interestApp.setErrorHandler((error, request, reply) => {
      if (error instanceof InterestProfileError) {
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
          message: "The interest request does not match the API contract.",
        });
      }
      request.log.error(error);
      return reply
        .code(500)
        .send({ code: "INTERNAL_ERROR", message: "The interest profile request failed." });
    });

    interestApp.get(
      "/v1/interests/cards",
      {
        schema: {
          tags: ["interests"],
          summary: "List the versioned public Interest Card registry",
          response: {
            200: Type.Object({
              taxonomyVersion: Type.Literal("interest_cards_v1"),
              minSelections: Type.Literal(3),
              maxSelections: Type.Literal(8),
              cards: Type.Array(
                Type.Object({
                  code: cardCodeSchema,
                  label: Type.String(),
                  categoryCodes: Type.Array(Type.String()),
                  topicCodes: Type.Array(Type.String()),
                }),
              ),
            }),
          },
        },
      },
      () => ({
        taxonomyVersion: "interest_cards_v1" as const,
        minSelections: 3 as const,
        maxSelections: 8 as const,
        cards: service.listCards(),
      }),
    );

    interestApp.get<{ Headers: { authorization?: string; "x-anonymous-subject-id"?: string } }>(
      "/v1/interest-profile",
      {
        schema: {
          tags: ["interests"],
          summary: "Read the Guest or Member Interest Profile",
          headers: identityHeaders,
          response: {
            200: profileSchema,
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request) =>
        service.getProfile({
          sessionToken: bearerToken(request.headers.authorization) ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
        }),
    );

    interestApp.put<{
      Headers: { authorization?: string; "x-anonymous-subject-id"?: string };
      Body: {
        selectedCardCodes: (typeof INTEREST_CARD_CODES)[number][];
        onboardingState: "COMPLETED" | "SKIPPED";
      };
    }>(
      "/v1/interest-profile",
      {
        schema: {
          tags: ["interests"],
          summary: "Complete, edit, or skip Interest onboarding",
          headers: identityHeaders,
          body: Type.Object({
            selectedCardCodes: Type.Array(cardCodeSchema, { maxItems: 8, uniqueItems: true }),
            onboardingState: Type.Union([Type.Literal("COMPLETED"), Type.Literal("SKIPPED")]),
          }),
          response: {
            200: profileSchema,
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            422: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request) =>
        service.saveProfile({
          sessionToken: bearerToken(request.headers.authorization) ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
          ...request.body,
        }),
    );

    interestApp.post<{ Headers: { authorization?: string; "x-anonymous-subject-id"?: string } }>(
      "/v1/interest-profile/reset",
      {
        schema: {
          tags: ["interests"],
          summary: "Reset personalization signals without deleting participation history",
          headers: identityHeaders,
          response: {
            200: profileSchema,
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request) =>
        service.resetProfile({
          sessionToken: bearerToken(request.headers.authorization) ?? undefined,
          anonymousSubjectId: request.headers["x-anonymous-subject-id"],
        }),
    );

    interestApp.post<{
      Headers: { authorization?: string; "x-anonymous-subject-id"?: string };
      Body: {
        anonymousSubjectId: string;
        selectedCardCodes: (typeof INTEREST_CARD_CODES)[number][];
      };
    }>(
      "/v1/interest-profile/merge",
      {
        schema: {
          tags: ["interests"],
          summary: "Confirm selected Guest interests for a linked Member",
          headers: identityHeaders,
          body: Type.Object({
            anonymousSubjectId: uuidSchema,
            selectedCardCodes: Type.Array(cardCodeSchema, { maxItems: 8, uniqueItems: true }),
          }),
          response: {
            200: profileSchema,
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            409: errorSchema,
            422: errorSchema,
            500: errorSchema,
          },
        },
      },
      async (request) =>
        service.mergeGuestProfile({
          sessionToken: bearerToken(request.headers.authorization) ?? undefined,
          anonymousSubjectId: request.body.anonymousSubjectId,
          selectedCardCodes: request.body.selectedCardCodes,
        }),
    );
  });
}
