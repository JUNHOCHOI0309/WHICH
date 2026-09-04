import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/feedback/toast-provider", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { OpsEditorialPanel } from "@/features/operations/ops-editorial-panel";

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

function candidate(candidateId: string, question: string) {
  return {
    candidateId,
    question,
    context: "테스트",
    choices: [
      { code: "A", label: "첫 번째", media: null },
      { code: "B", label: "두 번째", media: null },
    ],
    category: "DAILY",
    interestCardCodes: ["DAILY_LIFE"],
    editorialArea: "LIFE",
    riskLevel: "LOW",
    inventoryScope: "ACTIVE",
    discoveryLead: "test",
    sourceRequirement: "NOT_REQUIRED_SUBJECTIVE",
    sources: [],
    automatedReviewStatus: "PASSED",
    decision: null,
    publication: null,
  };
}

function page(items: ReturnType<typeof candidate>[], nextCursor: string | null) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-05T00:00:00.000Z",
    catalog: { id: "catalog", total: 100, approval: "PENDING" },
    inventory: { active: 100, reserve: 0, longTerm: 0 },
    counts: { PENDING: 100, APPROVED: 0, NEEDS_CHANGES: 0, REJECTED: 0 },
    items,
    nextCursor,
  };
}

describe("Ops Editorial panel", () => {
  it("loads the next candidate page without replacing the current list", async () => {
    const first = candidate("WEXP-0001", "첫 페이지 질문");
    const second = candidate("WEXP-0051", "두 번째 페이지 질문");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("cursor=WEXP-0001")) return response(page([second], null));
      if (url.startsWith("/api/ops/editorial?")) return response(page([first], "WEXP-0001"));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded />);

    fireEvent.click(
      await screen.findByRole("button", { name: "다음 50개 불러오기" }, { timeout: 5_000 }),
    );
    expect(
      await screen.findByText("두 번째 페이지 질문", undefined, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getAllByText("첫 페이지 질문")[0]).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("cursor=WEXP-0001"))).toBe(
      true,
    );
  });

  it("replenishes a filtered pending list after a decision", async () => {
    const first = candidate("WEXP-0001", "검수할 첫 질문");
    const second = candidate("WEXP-0002", "자동으로 채워진 다음 질문");
    let pendingLoads = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/ops/editorial?") && url.includes("status=PENDING")) {
        pendingLoads += 1;
        return response(page([pendingLoads === 1 ? first : second], null));
      }
      if (url.startsWith("/api/ops/editorial?")) return response(page([first], null));
      if (url.endsWith("/decision") && init?.method === "PUT") {
        return response({
          status: "REJECTED",
          note: "",
          reviewedBy: "운영자",
          reviewedAt: "2026-09-05T01:00:00.000Z",
          revision: 1,
          checks: {
            binaryFit: false,
            choiceParity: false,
            duplicateReview: false,
            sourceReview: false,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded />);
    fireEvent.change((await screen.findAllByRole("combobox"))[0]!, {
      target: { value: "PENDING" },
    });
    await waitFor(() => expect(pendingLoads).toBe(1), { timeout: 5_000 });
    fireEvent.click(await screen.findByRole("button", { name: "반려" }, { timeout: 5_000 }));

    expect(
      await screen.findByRole("heading", { name: "자동으로 채워진 다음 질문" }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(pendingLoads).toBe(2);
  });

  it("selects an approved image and removes it when selected again", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/ops/editorial?")) {
        return response({
          schemaVersion: 1,
          generatedAt: "2026-09-04T00:00:00.000Z",
          catalog: { id: "catalog", total: 1, approval: "PENDING" },
          inventory: { active: 1, reserve: 0, longTerm: 0 },
          counts: { PENDING: 1, APPROVED: 0, NEEDS_CHANGES: 0, REJECTED: 0 },
          items: [
            {
              candidateId: "WEXP-0001",
              question: "오늘의 선택은?",
              context: "테스트",
              choices: [
                { code: "A", label: "첫 번째", media: null },
                { code: "B", label: "두 번째", media: null },
              ],
              category: "DAILY",
              interestCardCodes: ["DAILY_LIFE"],
              editorialArea: "LIFE",
              riskLevel: "LOW",
              inventoryScope: "ACTIVE",
              discoveryLead: "test",
              sourceRequirement: "NONE",
              sources: [],
              automatedReviewStatus: "PASSED",
              decision: null,
              publication: null,
            },
          ],
          nextCursor: null,
        });
      }
      if (url === "/api/ops/media-review/assets?status=APPROVED") {
        return response({
          schemaVersion: 1,
          generatedAt: "2026-09-04T00:00:00.000Z",
          counts: { PENDING: 0, APPROVED: 1, REJECTED: 0, HIDDEN: 0, DELETED: 0 },
          items: [
            {
              id: "asset-1",
              effectiveStatus: "APPROVED",
              rightsState: "ASSERTED",
              link: null,
            },
          ],
        });
      }
      if (url.endsWith("/choices/A/media") && init?.method === "PUT") {
        return response({
          media: {
            assetId: "asset-1",
            status: "APPROVED",
            rightsState: "ASSERTED",
            altText: "오늘의 선택은? - 첫 번째",
            cropMode: "COVER",
          },
        });
      }
      if (url.endsWith("/choices/A/media") && init?.method === "DELETE") {
        return response({ detached: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded />);

    const libraryButtons = await screen.findAllByRole(
      "button",
      {
        name: "라이브러리에서 선택",
      },
      { timeout: 5_000 },
    );
    fireEvent.click(libraryButtons[0]!);
    fireEvent.click(await screen.findByAltText("승인 이미지", undefined, { timeout: 5_000 }));

    expect(
      await screen.findByAltText("오늘의 선택은? - 첫 번째", undefined, { timeout: 5_000 }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "이미지 변경·해제" }));
    fireEvent.click(await screen.findByText("한 번 더 눌러 해제", undefined, { timeout: 5_000 }));

    await waitFor(
      () => expect(screen.queryByAltText("오늘의 선택은? - 첫 번째")).not.toBeInTheDocument(),
      { timeout: 5_000 },
    );
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(true);
  });

  it("publishes an approved candidate and moves to the published view", async () => {
    const onPublished = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/ops/editorial?")) {
        return response({
          schemaVersion: 1,
          generatedAt: "2026-09-05T00:00:00.000Z",
          catalog: { id: "catalog", total: 1, approval: "PENDING" },
          inventory: { active: 1, reserve: 0, longTerm: 0 },
          counts: { PENDING: 0, APPROVED: 1, NEEDS_CHANGES: 0, REJECTED: 0 },
          items: [
            {
              candidateId: "WEXP-0001",
              question: "오늘의 선택은?",
              context: "테스트",
              choices: [
                { code: "A", label: "첫 번째", media: null },
                { code: "B", label: "두 번째", media: null },
              ],
              category: "DAILY",
              interestCardCodes: ["DAILY_LIFE"],
              editorialArea: "LIFE",
              riskLevel: "LOW",
              inventoryScope: "ACTIVE",
              discoveryLead: "test",
              sourceRequirement: "NOT_REQUIRED_SUBJECTIVE",
              sources: [],
              automatedReviewStatus: "PASSED",
              decision: {
                status: "APPROVED",
                note: "게시 승인",
                reviewedBy: "운영자",
                reviewedAt: "2026-09-05T00:00:00.000Z",
                revision: 3,
                checks: {
                  binaryFit: true,
                  choiceParity: true,
                  duplicateReview: true,
                  sourceReview: true,
                },
              },
              publication: null,
            },
          ],
          nextCursor: null,
        });
      }
      if (url.endsWith("/publish") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 3 });
        return response({
          issue: {
            issueId: "04f0ee31-f57c-5333-bdd2-9041a2440640",
            version: 1,
            publishedAt: "2026-09-05T01:00:00.000Z",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded onPublished={onPublished} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "승인된 질문 게시" }, { timeout: 5_000 }),
    );
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true);
  });
});
