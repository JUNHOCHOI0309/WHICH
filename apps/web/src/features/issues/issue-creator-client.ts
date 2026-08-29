import type {
  ApiErrorBody,
  CreateIssueCommand,
  CreateIssueResponse,
  InterestCardRegistry,
  IssueMediaLibraryPair,
} from "@/lib/contracts";

async function responseBody<T>(response: Response) {
  const payload = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const error = payload as ApiErrorBody;
    const reason = new Error(error.message || "질문을 만들지 못했습니다.");
    Object.assign(reason, { code: error.code, status: response.status });
    throw reason;
  }
  return payload as T;
}

export async function loadIssueCreationContext() {
  const [session, registry] = await Promise.all([
    fetch("/api/member-session", { cache: "no-store" }),
    fetch("/api/interests/cards", { cache: "no-store" }),
  ]);
  if (session.status === 401) return { authenticated: false as const, registry: null };
  if (!session.ok) throw new Error("로그인 상태를 확인하지 못했습니다.");
  return {
    authenticated: true as const,
    registry: await responseBody<InterestCardRegistry>(registry),
  };
}

export async function createMemberIssue(command: CreateIssueCommand, idempotencyKey: string) {
  return responseBody<CreateIssueResponse>(
    await fetch("/api/issues", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(command),
    }),
  );
}

export async function loadIssueMediaLibrary(query = "") {
  const search = new URLSearchParams({ limit: "24" });
  if (query.trim()) search.set("q", query.trim());
  return responseBody<{ items: IssueMediaLibraryPair[] }>(
    await fetch(`/api/issue-media-library?${search}`, { cache: "no-store" }),
  );
}
