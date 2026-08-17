import type { ApiErrorBody, PublicIssue, VoteResponse } from "@/lib/contracts";

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
