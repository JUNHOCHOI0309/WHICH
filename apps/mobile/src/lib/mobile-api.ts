import type {
  ApiErrorBody,
  CommentHighlights,
  CommentReportReason,
  InterestCardCode,
  InterestCardRegistry,
  InterestProfile,
  MemberPointView,
  PointRewardClaimResponse,
  MemberAccountDeletionResult,
  MemberAvatarUpdate,
  MemberPrivateProfile,
  MemberProfileSettings,
  MemberSessionView,
  MemberView,
  PublicIssue,
  PublicIssueFeed,
  PublicComment,
  PublicCommentPage,
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
  const rawBody = await response.text();
  let body: T | ApiErrorBody;
  try {
    body = JSON.parse(rawBody) as T | ApiErrorBody;
  } catch {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.error("Mobile API returned a non-JSON response", {
        contentType: response.headers.get("content-type"),
        preview: rawBody.slice(0, 160),
        status: response.status,
      });
    }
    throw new MobileApiError(
      "INVALID_RESPONSE",
      response.status,
      `서버 응답을 처리하지 못했습니다. (${response.status})`,
    );
  }
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

    async loadMemberProfile(
      sessionToken: string,
      options: { limit?: number; cursor?: string } = {},
    ) {
      const search = new URLSearchParams({ limit: String(options.limit ?? 5) });
      if (options.cursor) search.set("cursor", options.cursor);
      const response = await request(`${baseUrl}/api/mobile/v1/me?${search.toString()}`, {
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      });
      return bodyOrError<MemberPrivateProfile>(response);
    },

    async updateMemberProfile(
      sessionToken: string,
      command: {
        displayName: string;
        handle: string;
        bio: string | null;
        visibility: "PRIVATE" | "PUBLIC";
      },
    ) {
      const response = await request(`${baseUrl}/api/mobile/v1/me/profile`, {
        method: "PATCH",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
      });
      return bodyOrError<MemberProfileSettings>(response);
    },

    async uploadMemberAvatar(
      sessionToken: string,
      avatar: { uri: string; name: string; type: string },
    ) {
      const assetResponse = await request(avatar.uri);
      if (!assetResponse.ok) {
        throw new MobileApiError(
          "AVATAR_FILE_UNREADABLE",
          assetResponse.status,
          "선택한 이미지를 읽지 못했습니다.",
        );
      }
      const source = await assetResponse.blob();
      const file = source.type === avatar.type ? source : source.slice(0, source.size, avatar.type);
      const form = new FormData();
      form.append("avatar", file, avatar.name);
      const response = await request(`${baseUrl}/api/mobile/v1/me/avatar`, {
        method: "PUT",
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      return bodyOrError<MemberAvatarUpdate>(response);
    },

    async removeMemberAvatar(sessionToken: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/me/avatar`, {
        method: "DELETE",
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      });
      return bodyOrError<MemberAvatarUpdate>(response);
    },

    async deleteMemberAccount(sessionToken: string, password: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/me`, {
        method: "DELETE",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password, confirmation: "DELETE" }),
      });
      return bodyOrError<MemberAccountDeletionResult>(response);
    },

    async exchangeMobileSession(command: {
      ticket: string;
      codeVerifier: string;
      state: string;
      nonce: string;
      anonymousSubjectId?: string;
    }) {
      const response = await request(`${baseUrl}/api/mobile/v1/mobile-auth/member-sessions`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      return bodyOrError<MemberSessionView>(response);
    },

    async loadMemberSession(sessionToken: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/member-session`, {
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      });
      return bodyOrError<{ expiresAt: string; member: MemberView }>(response);
    },

    async refreshMemberSession(sessionToken: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/member-session`, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      });
      return bodyOrError<MemberSessionView>(response);
    },

    async revokeMemberSession(sessionToken: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/member-session`, {
        method: "DELETE",
        headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok && response.status !== 401) {
        throw new MobileApiError(
          "SESSION_REVOKE_FAILED",
          response.status,
          "로그아웃하지 못했습니다.",
        );
      }
    },

    async loadFeed(subjectId?: string, limit = 10, excludeIssueId?: string, sessionToken?: string) {
      const search = new URLSearchParams({ limit: String(limit) });
      if (excludeIssueId) search.set("excludeIssueId", excludeIssueId);
      const response = await request(`${baseUrl}/api/mobile/v1/issues/feed?${search.toString()}`, {
        headers: {
          accept: "application/json",
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        },
      });
      return bodyOrError<PublicIssueFeed>(response);
    },

    async loadIssue(issueId: string, subjectId?: string, sessionToken?: string) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(issueId)}`,
        {
          headers: {
            accept: "application/json",
            ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
            ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
          },
        },
      );
      return bodyOrError<PublicIssue>(response);
    },

    async loadCommentHighlights(
      subjectId: string | undefined,
      issueId: string,
      sessionToken?: string,
    ) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(issueId)}/comment-highlights`,
        {
          headers: {
            accept: "application/json",
            ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
            ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
          },
        },
      );
      return bodyOrError<CommentHighlights>(response);
    },

    async loadComments(command: {
      issueId: string;
      subjectId?: string;
      sessionToken?: string;
      side?: "ALL" | "A" | "B";
      cursor?: string;
      limit?: number;
    }) {
      const search = new URLSearchParams({
        side: command.side ?? "ALL",
        limit: String(command.limit ?? 10),
      });
      if (command.cursor) search.set("cursor", command.cursor);
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(command.issueId)}/comments?${search.toString()}`,
        {
          headers: {
            accept: "application/json",
            ...(command.subjectId ? { "x-anonymous-subject-id": command.subjectId } : {}),
            ...(command.sessionToken ? { authorization: `Bearer ${command.sessionToken}` } : {}),
          },
        },
      );
      return bodyOrError<PublicCommentPage>(response);
    },

    async submitComment(command: {
      issueId: string;
      subjectId?: string;
      sessionToken: string;
      idempotencyKey: string;
      body: string;
    }) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/issues/${encodeURIComponent(command.issueId)}/comments`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${command.sessionToken}`,
            "content-type": "application/json",
            "idempotency-key": command.idempotencyKey,
            ...(command.subjectId ? { "x-anonymous-subject-id": command.subjectId } : {}),
          },
          body: JSON.stringify({ body: command.body }),
        },
      );
      return bodyOrError<{ comment: PublicComment }>(response);
    },

    async toggleHelpfulReaction(command: {
      commentId: string;
      subjectId?: string;
      sessionToken?: string;
      idempotencyKey: string;
    }) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/comments/${encodeURIComponent(command.commentId)}/reactions/helpful`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "idempotency-key": command.idempotencyKey,
            ...(command.subjectId ? { "x-anonymous-subject-id": command.subjectId } : {}),
            ...(command.sessionToken ? { authorization: `Bearer ${command.sessionToken}` } : {}),
          },
        },
      );
      return bodyOrError<{
        reaction: { code: "HELPFUL"; active: boolean; helpfulCount: number };
      }>(response);
    },

    async reportComment(command: {
      commentId: string;
      subjectId?: string;
      sessionToken?: string;
      idempotencyKey: string;
      reason: CommentReportReason;
      detail?: string;
    }) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/comments/${encodeURIComponent(command.commentId)}/reports`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "idempotency-key": command.idempotencyKey,
            ...(command.subjectId ? { "x-anonymous-subject-id": command.subjectId } : {}),
            ...(command.sessionToken ? { authorization: `Bearer ${command.sessionToken}` } : {}),
          },
          body: JSON.stringify({ reason: command.reason, detail: command.detail }),
        },
      );
      return bodyOrError<{
        report: { accepted: true; viewerReported: true };
        comment: { visibility: "VISIBLE" | "DEPRIORITIZED" | "COLLAPSED" | "HIDDEN" };
      }>(response);
    },

    async loadInterestCards() {
      const response = await request(`${baseUrl}/api/mobile/v1/interests/cards`, {
        headers: { accept: "application/json" },
      });
      return bodyOrError<InterestCardRegistry>(response);
    },

    async loadInterestProfile(subjectId?: string, sessionToken?: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile`, {
        headers: {
          accept: "application/json",
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        },
      });
      return bodyOrError<InterestProfile>(response);
    },

    async saveInterestProfile(command: {
      subjectId?: string;
      sessionToken?: string;
      selectedCardCodes: InterestCardCode[];
      onboardingState: "COMPLETED" | "SKIPPED";
    }) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile`, {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(command.subjectId ? { "x-anonymous-subject-id": command.subjectId } : {}),
          ...(command.sessionToken ? { authorization: `Bearer ${command.sessionToken}` } : {}),
        },
        body: JSON.stringify({
          selectedCardCodes: command.selectedCardCodes,
          onboardingState: command.onboardingState,
        }),
      });
      return bodyOrError<InterestProfile>(response);
    },

    async resetInterestProfile(subjectId?: string, sessionToken?: string) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile/reset`, {
        method: "POST",
        headers: {
          accept: "application/json",
          ...(subjectId ? { "x-anonymous-subject-id": subjectId } : {}),
          ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        },
      });
      return bodyOrError<InterestProfile>(response);
    },

    async mergeGuestInterestProfile(command: {
      sessionToken: string;
      anonymousSubjectId: string;
      selectedCardCodes: InterestCardCode[];
    }) {
      const response = await request(`${baseUrl}/api/mobile/v1/interest-profile/merge`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${command.sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          anonymousSubjectId: command.anonymousSubjectId,
          selectedCardCodes: command.selectedCardCodes,
        }),
      });
      return bodyOrError<InterestProfile>(response);
    },

    async loadMemberVote(sessionToken: string, issueId: string) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/me/votes/${encodeURIComponent(issueId)}`,
        { headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` } },
      );
      if (response.status === 404) return null;
      return bodyOrError<VoteResponse>(response);
    },

    async recordAnalyticsEvent(command: {
      sessionId: string;
      eventId: string;
      eventType:
        | "ISSUE_VIEWABLE_IMPRESSION"
        | "VOTE_SUBMIT"
        | "RESULT_VIEW"
        | "NEXT_ISSUE_OPEN"
        | "NEXT_ISSUE_EXHAUSTED"
        | "INTEREST_PROMPT_VIEW"
        | "INTEREST_SELECTION_COMPLETE"
        | "INTEREST_PROMPT_SKIP"
        | "PERSONALIZED_FEED_VIEW"
        | "PERSONALIZED_ISSUE_OPEN"
        | "ISSUE_MEDIA_LOAD"
        | "SHARE_OPEN"
        | "SHARE_CHOICE_TOGGLE"
        | "SHARE_COMPLETE"
        | "COMMENT_COMPLETE"
        | "COMMENT_REPORT_COMPLETE";
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

    async confirmShareReward(command: {
      sessionToken: string;
      shareCardId: string;
      idempotencyKey: string;
    }) {
      const response = await request(
        `${baseUrl}/api/mobile/v1/share-cards/${encodeURIComponent(command.shareCardId)}/reward-claims`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${command.sessionToken}`,
            "idempotency-key": command.idempotencyKey,
          },
        },
      );
      return bodyOrError<PointRewardClaimResponse>(response);
    },

    async submitGuestVote(command: {
      subjectId?: string;
      sessionToken?: string;
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
            ...(command.subjectId ? { "x-anonymous-subject-id": command.subjectId } : {}),
            ...(command.sessionToken ? { authorization: `Bearer ${command.sessionToken}` } : {}),
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
