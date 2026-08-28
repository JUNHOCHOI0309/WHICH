import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicIssue, PublicShareCard } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  readIssue: vi.fn(),
  readShare: vi.fn(),
}));

vi.mock("@/lib/server/public-discovery", () => ({
  readPublicIssueForDiscovery: mocks.readIssue,
}));
vi.mock("@/lib/server/result-sharing", () => ({ readResultShareCard: mocks.readShare }));

import { generateMetadata } from "@/app/issues/[issueId]/page";

const issue: PublicIssue = {
  id: "10000000-0000-4000-8000-000000000001",
  version: 2,
  question: "생활 안내를 받을 때 어떤 형식이 더 좋나요?",
  context: "복잡한 정보를 처음 확인하는 상황을 떠올려 주세요.",
  publishedAt: "2026-08-29T00:00:00.000Z",
  categoryCode: "SOCIETY",
  experienceModeCode: "CORE_VOTE",
  mediaMode: "TEXT_ONLY",
  choices: [
    { id: "choice-a", code: "A", label: "핵심만 한 번에 요약하기", media: null },
    { id: "choice-b", code: "B", label: "근거와 원문 링크까지 보여주기", media: null },
  ],
  author: null,
  result: { visibility: "PRE_VOTE_HIDDEN", tally: null },
};

function props(query: Record<string, string> = {}) {
  return { params: Promise.resolve({ issueId: issue.id }), searchParams: Promise.resolve(query) };
}

describe("Issue search metadata", () => {
  beforeEach(() => {
    mocks.readIssue.mockReset().mockResolvedValue({ status: "available", value: issue });
    mocks.readShare.mockReset();
  });

  it("uses the current question, clean canonical, and no result spoiler", async () => {
    const metadata = await generateMetadata(props());
    expect(metadata.title).toBe(issue.question);
    expect(metadata.alternates).toEqual({ canonical: `/issues/${issue.id}` });
    expect(metadata.description).toContain("A. 핵심만 한 번에 요약하기");
    expect(metadata.description).not.toContain("50%");
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("propagates an upstream outage instead of serving a temporary noindex page", async () => {
    mocks.readIssue.mockRejectedValue(new Error("upstream unavailable"));
    await expect(generateMetadata(props())).rejects.toThrow("upstream unavailable");
  });

  it("keeps tracked variants out of the index while pointing to the clean canonical", async () => {
    const metadata = await generateMetadata(props({ utm_source: "google", utm_medium: "organic" }));
    expect(metadata.alternates).toEqual({ canonical: `/issues/${issue.id}` });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it("uses a current matching share card for social preview but never indexes it", async () => {
    const share: PublicShareCard = {
      id: "30000000-0000-4000-8000-000000000001",
      version: "result_share_v1",
      channel: "COPY",
      shareType: "RESULT",
      sharedChoiceCode: "A",
      createdAt: "2026-08-29T00:01:00.000Z",
      issue: {
        id: issue.id,
        version: issue.version,
        question: issue.question,
        choices: issue.choices.map(({ code, label }) => ({ code, label })),
      },
      result: {
        resultVersion: 1,
        acceptedA: 3,
        acceptedB: 1,
        displayedTotal: 4,
        integrityState: "NORMAL",
      },
    };
    mocks.readShare.mockResolvedValue(Response.json(share));
    const metadata = await generateMetadata(props({ share: share.id }));
    expect(metadata.description).toContain("A 75% · B 25%");
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toEqual({ canonical: `/issues/${issue.id}` });
  });

  it("does not expose stale share results from another Issue version", async () => {
    mocks.readShare.mockResolvedValue(
      Response.json({
        id: "30000000-0000-4000-8000-000000000001",
        issue: { id: issue.id, version: 1 },
      }),
    );
    const metadata = await generateMetadata(
      props({ share: "30000000-0000-4000-8000-000000000001" }),
    );
    expect(metadata.description).not.toContain("%");
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });
});
