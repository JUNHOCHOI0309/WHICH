import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/feedback/toast-provider", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { OpsEditorialPanel } from "@/features/operations/ops-editorial-panel";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

function candidate(candidateId: string, question: string) {
  return {
    candidateId,
    question,
    context: "테스트 설명",
    choices: [
      { code: "A", label: "첫 번째", media: null },
      { code: "B", label: "두 번째", media: null },
    ],
    category: "LIFE",
    interestCardCodes: ["DAILY_LIFE"],
    editorialArea: "LIFE",
    riskLevel: "LOW",
    inventoryScope: "ACTIVE",
    discoveryLead: "EDITORIAL",
    sourceRequirement: "NOT_REQUIRED_SUBJECTIVE",
    sources: [],
    automatedReviewStatus: "ADMIN_CREATED_PENDING_REVIEW",
    decision: null,
    publication: null,
  };
}

function page(items: unknown[], nextCursor: string | null) {
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

function libraryResponse() {
  return response({ items: [] });
}

describe("Ops Editorial panel", () => {
  it("loads the next candidate page without replacing the current list", async () => {
    const first = candidate("WEXP-0001", "첫 페이지 질문");
    const second = candidate("WEXP-0051", "두 번째 페이지 질문");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/ops/media-library") return libraryResponse();
      if (url.includes("cursor=WEXP-0001")) return response(page([second], null));
      if (url.startsWith("/api/ops/editorial?")) return response(page([first], "WEXP-0001"));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded />);
    fireEvent.click(await screen.findByRole("button", { name: "다음 50개 불러오기" }));

    expect(await screen.findByText("두 번째 페이지 질문")).toBeVisible();
    expect(screen.getAllByText("첫 페이지 질문")[0]).toBeVisible();
  });

  it("records a simple approve or reject decision without notes or checkboxes", async () => {
    const first = candidate("WEXP-0001", "검수할 질문");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ops/media-library") return libraryResponse();
      if (url.startsWith("/api/ops/editorial?")) return response(page([first], null));
      if (url.endsWith("/decision") && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 0, status: "REJECTED" });
        return response({
          status: "REJECTED",
          note: "",
          reviewedBy: "운영자",
          reviewedAt: "2026-09-05T01:00:00.000Z",
          revision: 1,
          checks: {
            binaryFit: true,
            choiceParity: true,
            duplicateReview: true,
            sourceReview: true,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded />);
    fireEvent.click(await screen.findByRole("button", { name: "반려" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(true),
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수정 요청" })).not.toBeInTheDocument();
  });

  it("uploads, immediately publishes, attaches, and removes an admin choice image", async () => {
    const first = candidate("WEXP-0001", "오늘의 선택은?");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ops/media-library") return libraryResponse();
      if (url.startsWith("/api/ops/editorial?")) return response(page([first], null));
      if (url === "/api/ops/editorial/media-assets" && init?.method === "POST") {
        return response(
          { asset: { id: "asset-1", moderationState: "PENDING", storageState: "STAGED" } },
          201,
        );
      }
      if (url.endsWith("/media-assets/asset-1/publish") && init?.method === "POST") {
        return response({
          asset: { id: "asset-1", moderationState: "APPROVED", storageState: "PUBLISHED" },
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
    const uploads = await screen.findAllByLabelText("새 이미지 업로드");
    fireEvent.change(uploads[0]!, {
      target: { files: [new File(["image"], "a.png", { type: "image/png" })] },
    });

    expect(await screen.findByAltText("오늘의 선택은? - 첫 번째")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "이미지 제거" }));
    await waitFor(() =>
      expect(screen.queryByAltText("오늘의 선택은? - 첫 번째")).not.toBeInTheDocument(),
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        "/api/ops/editorial/media-assets",
        "/api/ops/editorial/media-assets/asset-1/publish",
        "/api/ops/editorial/WEXP-0001/choices/A/media",
      ]),
    );
  });

  it("adds a new administrator question to the review queue", async () => {
    const existing = candidate("WEXP-0001", "기존 질문");
    const created = candidate("ADMIN-NEW-0001", "새 관리자 질문?");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ops/media-library") return libraryResponse();
      if (url.startsWith("/api/ops/editorial?") && !init?.method)
        return response(page([existing], null));
      if (url === "/api/ops/editorial" && init?.method === "POST")
        return response({ candidate: created }, 201);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded />);
    fireEvent.click(await screen.findByRole("button", { name: "새 질문 추가" }));
    fireEvent.change(screen.getByPlaceholderText("질문"), { target: { value: "새 관리자 질문?" } });
    fireEvent.change(screen.getByPlaceholderText("짧은 설명"), {
      target: { value: "간단한 설명" },
    });
    fireEvent.change(screen.getByPlaceholderText("A 선택지"), { target: { value: "찬성" } });
    fireEvent.change(screen.getByPlaceholderText("B 선택지"), { target: { value: "반대" } });
    fireEvent.click(screen.getByRole("button", { name: "검수 후보에 추가" }));

    expect(await screen.findByRole("heading", { name: "새 관리자 질문?" })).toBeVisible();
  });

  it("publishes an approved candidate", async () => {
    const approved = {
      ...candidate("WEXP-0001", "오늘의 선택은?"),
      decision: {
        status: "APPROVED" as const,
        note: "",
        reviewedBy: "운영자",
        reviewedAt: "2026-09-05T00:00:00.000Z",
        revision: 3,
        checks: { binaryFit: true, choiceParity: true, duplicateReview: true, sourceReview: true },
      },
    };
    const onPublished = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/ops/media-library") return libraryResponse();
      if (url.startsWith("/api/ops/editorial?")) return response(page([approved], null));
      if (url.endsWith("/publish") && init?.method === "POST")
        return response({
          issue: {
            issueId: "04f0ee31-f57c-5333-bdd2-9041a2440640",
            version: 1,
            publishedAt: "2026-09-05T01:00:00.000Z",
          },
        });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OpsEditorialPanel embedded onPublished={onPublished} />);
    fireEvent.click(await screen.findByRole("button", { name: "승인된 질문 게시" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1));
  });
});
