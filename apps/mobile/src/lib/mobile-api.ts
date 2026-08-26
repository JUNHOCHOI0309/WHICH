import type {
  ApiErrorBody,
  CommentHighlights,
  InterestCardCode,
  InterestCardRegistry,
  InterestProfile,
  MemberPointView,
  PublicIssue,
  PublicIssueFeed,
  ShareCardResponse,
  ShareChannel,
  VoteResponse,
} from "@/contracts";

export type RequestFunction = (input: string, init?: RequestInit) => Promise<Response>;

export class MobileApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

function normalizedBaseUrl(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function bodyOrError<T>(response: Response) {
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const error = body as ApiErrorBody;
    throw new MobileApiError(
      error.code || "UNKNOWN_ERROR",
      response.status,
      error.message || "요청을 처리하지 못했습니다.",
    );
  }
  return body as T;
}

export function createMobileApiClient(
  options: {
    baseUrl?: string;
    request?: RequestFunction;
  } = {},
) {
  const baseUrl = normalizedBaseUrl(
    options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://whichone.site",
  );
  const request = options.request ?? ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async createGuestSubject() {
      const response = await request(`${baseUrl}/api/mobile/v1/guest-subjects`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      return bodyOrError<{ anonymousSubjectId: string }>(response);
    },

    async loadMemberPoints(
      sessionToken: string,
      options: { limit?: number; cursor?: string } = {},
    ) {
      const search = new URLSearchParams({ limit: String(options.limit ?? 10) });
      if (options.cursor) search.set("cursor", options.cursor);
      const response = await request(`${baseUrl}/api/mobile/v1/me/points?${search.toString()}`, {
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      });
      return bodyOrError<MemberPointView>(response);
    },

    async loadFeed(subjectId?: string, limit = 10, excludeIssueId?: string) {
      const search = new URLSearchParams({ limit: String(limit) });
      if (excludeIssueId) search.set("excludeIssueId", excludeIssueId);
      const response = await request(`${baseUrl}/api/mobile/v1/issues/feed?${search.toString()}`, {
        headers: {
          accept: "application/json",
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
        },
      });
      return bodyOrError<PublicIssueFeed>(response);
    },

    async loadIssue(issueId: string, subjectId?: string) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(issueId)}`,
        {
          headers: {
            accept: "application/json",
            ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
          },
        },
      );
      return bodyOrError<PublicIssue>(response);
    },

    async loadCommentHighlights(subjectId: string, issueId: string) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(issueId)}/comment-highlights`,
        {
          headers: {
            accept: "application/json",
            "x-anonymous-subject-id": subjectId,
          },
        },
      );
      return bodyOrError<CommentHighlights>(response);
    },

    async loadInterestCards() {
      const response = await request(`${baseUrl}/api/mobile/v1/interests/cards`, {
        headers: { accept: "application/json" },
      });
      return bodyOrError<InterestCardRegistry>(response);
    },

    async loadInterestProfile(subjectId: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile`, {
        headers: { accept: "application/json", "x-anonymous-subject-id": subjectId },
      });
      return bodyOrError<InterestProfile>(response);
    },

    async saveInterestProfile(command: {
      subjectId: string;
      selectedCardCodes: InterestCardCode[];
      onboardingState: "COMPLETED" | "SKIPPED";
    }) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile`, {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-anonymous-subject-id": command.subjectId,
        },
        body: JSON.stringify({
          selectedCardCodes: command.selectedCardCodes,
          onboardingState: command.onboardingState,
        }),
      });
      return bodyOrError<InterestProfile>(response);
    },

    async resetInterestProfile(subjectId: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile/reset`, {
        method: "POST",
        headers: { accept: "application/json", "x-anonymous-subject-id": subjectId },
      });
      return bodyOrError<InterestProfile>(response);
    },

    async recordAnalyticsEvent(command: {
      sessionId: string;
      eventId: string;
      eventType:
        | "ISSUE_VIEWABLE_IMPRESSION"
        | "VOTE_SUBMIT"
        | "RESULT_VIEW"
        | "INTEREST_PROMPT_VIEW"
        | "INTEREST_SELECTION_COMPLETE"
        | "INTEREST_PROMPT_SKIP"
        | "PERSONALIZED_FEED_VIEW"
        | "PERSONALIZED_ISSUE_OPEN"
        | "ISSUE_MEDIA_LOAD"
        | "SHARE_OPEN"
        | "SHARE_CHOICE_TOGGLE"
        | "SHARE_COMPLETE";
      issueId: string;
      issueVersion: number;
      recommendationRequestId?: string;
      shareCardId?: string;
      occurredAt: string;
      quality?: {
        durationMs?: number;
        canonicalChoiceId?: string;
        shownPosition?: number;
        mediaMode?: "TEXT_ONLY" | "OPTION_IMAGES";
        mediaLoadOutcome?: "SUCCESS" | "FAILURE";
      };
    }) {
      const response = await request(`${baseUrl}/api/mobile/v1/analytics/events`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-analytics-session-id": command.sessionId,
        },
        body: JSON.stringify({
          eventId: command.eventId,
          eventType: command.eventType,
          issueId: command.issueId,
          issueVersion: command.issueVersion,
          recommendationRequestId: command.recommendationRequestId,
          shareCardId: command.shareCardId,
          quality: command.quality,
          occurredAt: command.occurredAt,
        }),
      });
      return bodyOrError<{ accepted: true; duplicate: boolean }>(response);
    },

    async createResultShareCard(command: {
      issueId: string;
      issueVersion: number;
      resultVersion: number;
      channel: ShareChannel;
      sharedChoiceCode?: "A" | "B";
    }) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(command.issueId)}/share-cards`,
        {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(command),
        },
      );
      return bodyOrError<ShareCardResponse>(response);
    },

    async submitGuestVote(command: {
      subjectId: string;
      issueId: string;
      issueVersion: number;
      choiceId: string;
      idempotencyKey: string;
    }) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(command.issueId)}/votes`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-anonymous-subject-id": command.subjectId,
          },
          body: JSON.stringify({
            issueVersion: command.issueVersion,
            choiceId: command.choiceId,
            idempotencyKey: command.idempotencyKey,
          }),
        },
      );
      const body = (await response.json()) as VoteResponse | ApiErrorBody;
      if (
        (response.ok || response.status === 409) &&
        "outcome" in body &&
        (body.outcome === "ACCEPTED" || body.outcome === "REJECTED_DUPLICATE")
      ) {
        return body;
      }
      const error = body as ApiErrorBody;
      throw new MobileApiError(
        error.code || "UNKNOWN_ERROR",
        response.status,
        error.message || "투표를 처리하지 못했습니다.",
      );
    },
  };
}

export type MobileApiClient = ReturnType<typeof createMobileApiClient>;
