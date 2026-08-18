import type {
  ApiErrorBody,
  CommentSide,
  CommentReportReason,
  CommentReportResponse,
  CommentWriteResponse,
  HelpfulReactionResponse,
  PublicCommentPage,
  PublicIssue,
  PublicIssueFeed,
  VoteResponse,
} from "@/lib/contracts";

export class WebApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebApiError";
  }
}

let guestPreparation: Promise<void> | null = null;

async function responseBody<T>(response: Response) {
  return (await response.json()) as T | ApiErrorBody;
}

function throwApiError(response: Response, body: ApiErrorBody): never {
  throw new WebApiError(body.code || "UNKNOWN_ERROR", response.status, body.message);
}

export async function loadPublicIssue(issueId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const body = await responseBody<PublicIssue>(response);

  if (!response.ok) throwApiError(response, body as ApiErrorBody);
  return body as PublicIssue;
}

export function ensureGuestSubject() {
  guestPreparation ??= (async () => {
    const response = await fetch("/api/guest-subjects", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const body = await responseBody<{ status: "ready" }>(response);
    if (!response.ok) throwApiError(response, body as ApiErrorBody);
  })().catch((error: unknown) => {
    guestPreparation = null;
    throw error;
  });

  return guestPreparation;
}

export function resetGuestPreparation() {
  guestPreparation = null;
}

export async function loadIssueFeed(
  options: {
    cursor?: string;
    limit?: number;
    excludeIssueId?: string;
    signal?: AbortSignal;
  } = {},
) {
  const search = new URLSearchParams();
  if (options.cursor) search.set("cursor", options.cursor);
  if (options.limit) search.set("limit", String(options.limit));
  if (options.excludeIssueId) search.set("excludeIssueId", options.excludeIssueId);

  const response = await fetch(`/api/issues/feed?${search.toString()}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: options.signal,
  });
  const body = await responseBody<PublicIssueFeed>(response);

  if (!response.ok) throwApiError(response, body as ApiErrorBody);
  return body as PublicIssueFeed;
}

export async function submitGuestVote(command: {
  issueId: string;
  issueVersion: number;
  choiceId: string;
  idempotencyKey: string;
}) {
  const response = await fetch(`/api/issues/${encodeURIComponent(command.issueId)}/votes`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      issueVersion: command.issueVersion,
      choiceId: command.choiceId,
      idempotencyKey: command.idempotencyKey,
    }),
  });
  const body = await responseBody<VoteResponse>(response);

  if (
    (response.ok || response.status === 409) &&
    "outcome" in body &&
    (body.outcome === "ACCEPTED" || body.outcome === "REJECTED_DUPLICATE")
  ) {
    return body;
  }

  throwApiError(response, body as ApiErrorBody);
}

export async function loadIssueComments(options: {
  issueId: string;
  side: CommentSide;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({ side: options.side });
  if (options.cursor) search.set("cursor", options.cursor);
  if (options.limit) search.set("limit", String(options.limit));

  const response = await fetch(
    `/api/issues/${encodeURIComponent(options.issueId)}/comments?${search.toString()}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: options.signal,
    },
  );
  const body = await responseBody<PublicCommentPage>(response);

  if (!response.ok) throwApiError(response, body as ApiErrorBody);
  return body as PublicCommentPage;
}

export async function submitMemberComment(command: {
  issueId: string;
  body: string;
  idempotencyKey: string;
}) {
  const response = await fetch(`/api/issues/${encodeURIComponent(command.issueId)}/comments`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": command.idempotencyKey,
    },
    body: JSON.stringify({ body: command.body }),
  });
  const body = await responseBody<CommentWriteResponse>(response);
  if (!response.ok) throwApiError(response, body as ApiErrorBody);
  return body as CommentWriteResponse;
}

export async function toggleHelpfulReaction(command: {
  commentId: string;
  idempotencyKey: string;
}) {
  const response = await fetch(
    `/api/comments/${encodeURIComponent(command.commentId)}/reactions/helpful`,
    {
      method: "POST",
      headers: { accept: "application/json", "idempotency-key": command.idempotencyKey },
    },
  );
  const body = await responseBody<HelpfulReactionResponse>(response);
  if (!response.ok) throwApiError(response, body as ApiErrorBody);
  return body as HelpfulReactionResponse;
}

export async function reportComment(command: {
  commentId: string;
  idempotencyKey: string;
  reason: CommentReportReason;
  detail?: string;
}) {
  const response = await fetch(`/api/comments/${encodeURIComponent(command.commentId)}/reports`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": command.idempotencyKey,
    },
    body: JSON.stringify({ reason: command.reason, detail: command.detail }),
  });
  const body = await responseBody<CommentReportResponse>(response);
  if (!response.ok) throwApiError(response, body as ApiErrorBody);
  return body as CommentReportResponse;
}
