import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsPollCandidatesPanel } from "@/features/operations/ops-poll-candidates-panel";
import { GET, POST } from "@/app/api/ops/poll-candidates/[[...path]]/route";
import { NextRequest } from "next/server";

const proxy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/ops-api", () => ({ proxyOpsApi: proxy }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const poll = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "NEW",
  editorialCandidateId: null,
  source: {
    channel: "진행빵집",
    originalQuestion: "쉬는 날에는 어디로?",
    originalChoices: ["집", "산", "바다", "공원"],
    sourceUrl: "https://www.youtube.com/post/UgkxTesting1234",
  },
};
describe("Ops poll inbox", () => {
  it("sends all four text choices to review and opens the persistent candidate", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "POST"
              ? { candidateId: "POLL-1234567890ABCDEF1234", replayed: false }
              : {
                  items: [poll],
                  channels: ["진행빵집"],
                  nextCursor: null,
                  octoparseConfigured: false,
                },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<OpsPollCandidatesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /쉬는 날에는 어디로/ }));
    expect(screen.getByLabelText("선택지 D")).toHaveValue("공원");
    fireEvent.click(screen.getByRole("button", { name: "검수 후보로 보내기" }));
    await screen.findByRole("link", { name: /Review Center에서 검수 후보 보기/ });
    const sent = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(sent?.[0]).toBe(`/api/ops/poll-candidates/${poll.id}/review`);
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
      choices: ["집", "산", "바다", "공원"],
      question: poll.source.originalQuestion,
    });
    expect(screen.queryByRole("button", { name: "검수 후보로 보내기" })).not.toBeInTheDocument();
  });
  it("preserves invalid import JSON and reports rejected rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Response(
            JSON.stringify(
              init?.method === "POST"
                ? {
                    imported: 0,
                    updated: 0,
                    errors: [{ row: 1, message: "원문을 확인해 주세요." }],
                  }
                : { items: [], channels: [], nextCursor: null },
            ),
            { status: 200 },
          ),
      ),
    );
    render(<OpsPollCandidatesPanel />);
    await waitFor(() =>
      expect(screen.queryByText("투표 후보를 불러오고 있습니다.")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("수집 결과 JSON 가져오기"));
    fireEvent.change(screen.getByLabelText("후보 JSON"), { target: { value: '[{"bad":true}]' } });
    fireEvent.click(screen.getByRole("button", { name: "투표 후보로 가져오기" }));
    expect(await screen.findByRole("status")).toHaveTextContent("제외 1개");
    expect(screen.getByLabelText("후보 JSON")).toHaveValue('[{"bad":true}]');
  });
  it("enforces same-origin writes and sends reads through operator authentication", async () => {
    const denied = await POST(
      new NextRequest("https://whichone.site/api/ops/poll-candidates/import", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: '{"rows":[]}',
      }),
      { params: Promise.resolve({ path: ["import"] }) },
    );
    expect(denied.status).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
    proxy.mockResolvedValue(new Response("{}"));
    await GET(new NextRequest("https://whichone.site/api/ops/poll-candidates"), {
      params: Promise.resolve({}),
    });
    expect(proxy).toHaveBeenCalledWith(expect.anything(), "/v1/internal/ops/poll-candidates", {
      method: "GET",
    });
  });
});
