import test from "node:test";
import assert from "node:assert/strict";
import worker, { testHooks } from "../src/worker.js";

class MemoryKv {
  constructor() {
    this.values = new Map();
  }
  async get(key, type) {
    const value = this.values.get(key);
    return type === "json" && value ? JSON.parse(value) : (value ?? null);
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list({ prefix }) {
    return {
      keys: [...this.values.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    };
  }
}

const allowedIp = "203.0.113.10";
const allowedHash = "631f08140b24b7274d12df3c37a1a80ce5876dafd7007d772e0114fddf88b682";
const env = () => ({
  STUDIO_KV: new MemoryKv(),
  ALLOWED_IP_SHA256: allowedHash,
  OPENAI_MODEL: "gpt-4.1-mini-2025-04-14",
  OPENAI_KEY_NAME: "WHICH-advertising-key",
  DAILY_BUDGET_USD: "0.5",
});

test("denies requests from a different network before routing", async () => {
  const response = await worker.fetch(
    new Request("https://studio.whichone.site/health", {
      headers: { "cf-connecting-ip": "198.51.100.8" },
    }),
    env(),
  );
  assert.equal(response.status, 403);
});

test("allows the configured IP and keeps health private", async () => {
  const response = await worker.fetch(
    new Request("https://studio.whichone.site/health", {
      headers: { "cf-connecting-ip": allowedIp },
    }),
    env(),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).storage, "cloudflare-kv");
});

test("rejects cross-origin mutations", async () => {
  const response = await worker.fetch(
    new Request(
      "https://studio.whichone.site/api/sources/00000000-0000-4000-8000-000000000001/completion",
      {
        method: "POST",
        headers: { "cf-connecting-ip": allowedIp, origin: "https://evil.example" },
      },
    ),
    env(),
  );
  assert.equal(response.status, 403);
});

test("exposes only completed Issue ids through the public read endpoint", async () => {
  const testEnv = env();
  const firstId = "00000000-0000-4000-8000-000000000002";
  const secondId = "00000000-0000-4000-8000-000000000001";
  await testEnv.STUDIO_KV.put(
    `completed:${firstId}`,
    JSON.stringify({ content: { text: "비공개 원고" } }),
  );
  await testEnv.STUDIO_KV.put(
    `completed:${secondId}`,
    JSON.stringify({ content: { text: "다른 비공개 원고" } }),
  );
  await testEnv.STUDIO_KV.put(
    "completed:not-an-issue",
    JSON.stringify({ content: { text: "무시" } }),
  );

  const response = await worker.fetch(
    new Request("https://studio.whichone.site/api/public/completions", {
      headers: { "cf-connecting-ip": "198.51.100.8" },
    }),
    testEnv,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { issueIds: [secondId, firstId] });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("cache-control"), /s-maxage=15/);
});

test("keeps the public completion endpoint read-only", async () => {
  const response = await worker.fetch(
    new Request("https://studio.whichone.site/api/public/completions", { method: "POST" }),
    env(),
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, OPTIONS");
});

test("retains completed source details after the public catalog filters them", async () => {
  const testEnv = env();
  const sourceId = "00000000-0000-4000-8000-000000000003";
  await testEnv.STUDIO_KV.put(
    "catalog:public:v1",
    JSON.stringify({
      items: [
        {
          id: sourceId,
          question: "이미 게시한 질문",
          choices: [
            { code: "A", label: "첫 번째" },
            { code: "B", label: "두 번째" },
          ],
          engagement: { recommendationCount: 2, commentCount: 1 },
        },
      ],
      recent: {},
      fetchedAt: "2026-09-15T00:00:00.000Z",
    }),
  );
  await testEnv.STUDIO_KV.put(`completed:${sourceId}`, JSON.stringify({ at: "2026-09-15" }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) =>
    String(input).includes("/public/issues.json")
      ? Response.json({ items: [] })
      : Response.json({ rightRail: { items: [] } });

  try {
    const headers = { "cf-connecting-ip": allowedIp, origin: "https://studio.whichone.site" };
    const refreshed = await worker.fetch(
      new Request("https://studio.whichone.site/api/sources/refresh", {
        method: "POST",
        headers,
      }),
      testEnv,
    );
    assert.equal(refreshed.status, 200);

    const response = await worker.fetch(
      new Request("https://studio.whichone.site/api/sources", {
        headers: { "cf-connecting-ip": allowedIp },
      }),
      testEnv,
    );
    const body = await response.json();
    assert.deepEqual(body.sources, []);
    assert.equal(body.completedSources[0].id, sourceId);
    assert.equal(body.completedSources[0].question, "이미 게시한 질문");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("popularity weights recent participation above comments", () => {
  const item = { id: "x", engagement: { recommendationCount: 0, commentCount: 1 } };
  assert.ok(
    testHooks.popularity(item, new Map([["x", 1]])) > testHooks.popularity(item, new Map()),
  );
});

test("renders executable browser script", async () => {
  const response = await worker.fetch(
    new Request("https://studio.whichone.site/", { headers: { "cf-connecting-ip": allowedIp } }),
    env(),
  );
  const html = await response.text();
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /5초 쇼츠 만들기/);
  assert.match(html, /http:\/\/127\.0\.0\.1:8783/);
  assert.match(html, /window\.location\.assign/);
  assert.match(html, /LOCAL_RENDERER\+'\/render\/'\+v\.id/);
  assert.match(response.headers.get("content-security-policy"), /http:\/\/127\.0\.0\.1:8783/);
});

test("normalizes the scheduled collector schema", () => {
  const item = testHooks.normalizeCandidate(
    {
      channel: "예시 채널",
      originalQuestion: "원문 질문",
      originalChoices: ["하나", "둘", "셋"],
      adaptedQuestion: "어느 쪽인가요?",
      adaptedChoices: ["A 선택", "B 선택"],
      sourceUrl: "https://www.youtube.com/post/example",
      category: "생활",
      political: false,
    },
    "2026-09-15T00:00:00.000Z",
  );
  assert.equal(item.question, "어느 쪽인가요?");
  assert.deepEqual(item.adaptedChoices, ["A 선택", "B 선택"]);
  assert.equal(item.sourceUrl, "https://www.youtube.com/post/example");
});

test("completion preserves the latest generated article", async () => {
  const testEnv = env();
  const sourceId = "00000000-0000-4000-8000-000000000001";
  const packageId = "a".repeat(64);
  const pkg = {
    id: packageId,
    generatedAt: "2026-09-15T00:00:00.000Z",
    model: "test-model",
    channels: [
      {
        title: "제목",
        text: "통합 본문",
        tags: ["WHICH"],
        poll: { question: "질문", choices: ["A", "B"] },
        trackedUrl: "https://whichone.site/",
      },
    ],
  };
  await testEnv.STUDIO_KV.put(`latest-package:${sourceId}`, JSON.stringify({ packageId }));
  await testEnv.STUDIO_KV.put(`package:${packageId}`, JSON.stringify(pkg));
  const requestHeaders = { "cf-connecting-ip": allowedIp, origin: "https://studio.whichone.site" };
  const completed = await worker.fetch(
    new Request(`https://studio.whichone.site/api/sources/${sourceId}/completion`, {
      method: "POST",
      headers: requestHeaders,
    }),
    testEnv,
  );
  assert.equal((await completed.json()).contentSaved, true);
  const stored = await worker.fetch(
    new Request(`https://studio.whichone.site/api/sources/${sourceId}/completion`, {
      headers: { "cf-connecting-ip": allowedIp },
    }),
    testEnv,
  );
  assert.equal((await stored.json()).content.text, "통합 본문");
});

test("collected candidates link to ops and never enter promotion sources directly", async () => {
  const testEnv = env();
  await testEnv.STUDIO_KV.put(
    "catalog:public:v1",
    JSON.stringify({
      items: [],
      recent: {},
      fetchedAt: new Date().toISOString(),
    }),
  );
  const requestHeaders = {
    "cf-connecting-ip": allowedIp,
    origin: "https://studio.whichone.site",
    "content-type": "application/json",
  };
  const imported = await worker.fetch(
    new Request("https://studio.whichone.site/api/youtube-candidates/import", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        candidates: [
          {
            channel: "예시 채널",
            adaptedQuestion: "주말에는 어디로 갈까요?",
            adaptedChoices: ["산", "바다"],
            sourceUrl: "https://www.youtube.com/post/example",
            category: "취향",
          },
        ],
      }),
    }),
    testEnv,
  );
  const candidate = (await imported.json()).candidates[0];

  const sourceResponse = await worker.fetch(
    new Request("https://studio.whichone.site/api/sources", {
      headers: { "cf-connecting-ip": allowedIp },
    }),
    testEnv,
  );
  const sourceBody = await sourceResponse.json();
  assert.equal(sourceBody.officialScanned, 0);
  assert.equal(sourceBody.sources.length, 0);

  const candidatesResponse = await worker.fetch(
    new Request("https://studio.whichone.site/api/youtube-candidates", {
      headers: { "cf-connecting-ip": allowedIp },
    }),
    testEnv,
  );
  const candidatesBody = await candidatesResponse.json();
  assert.equal(candidatesBody.candidates.length, 1);
  const adminUrl = new URL(candidatesBody.candidates[0].adminUrl);
  assert.equal(adminUrl.origin, "https://whichone.site");
  assert.equal(adminUrl.pathname, "/ops");
  assert.equal(adminUrl.searchParams.get("tab"), "review");
  assert.equal(adminUrl.searchParams.get("create"), "1");
  assert.equal(adminUrl.searchParams.get("question"), "주말에는 어디로 갈까요?");
  assert.equal(adminUrl.searchParams.get("choiceA"), "산");
  assert.equal(adminUrl.searchParams.get("choiceB"), "바다");
  assert.equal(adminUrl.searchParams.get("interestCardCode"), "HOBBY");

  const dismissed = await worker.fetch(
    new Request(`https://studio.whichone.site/api/youtube-candidates/${candidate.id}`, {
      method: "DELETE",
      headers: requestHeaders,
    }),
    testEnv,
  );
  assert.equal(dismissed.status, 200);
});

test("HyperFrames package stays deterministic, short, and free of invented results", () => {
  const pkg = testHooks.hyperframesPackage(
    {
      id: "00000000-0000-4000-8000-000000000001",
      version: 7,
      question: "퇴근 후 하나만 한다면?",
      context: "오늘 저녁 기준",
      choices: [
        { code: "A", label: "산책" },
        { code: "B", label: "집에서 휴식" },
      ],
      canonicalUrl: "https://whichone.site/issues/00000000-0000-4000-8000-000000000001",
    },
    { date: "2026-09-16", slot: "1330" },
    "b".repeat(64),
  );

  assert.equal(pkg.schema, "which-hyperframes-short-v1");
  assert.equal(pkg.render.durationSeconds, 5);
  assert.equal(pkg.render.estimatedFrames, 150);
  assert.equal(pkg.render.externalGenerationCostUsd, 0);
  assert.equal(pkg.variables.choiceA, "산책");
  assert.equal(pkg.variables.choiceB, "집에서 휴식");
  assert.equal(pkg.timeline.length, 4);
  assert.ok(!JSON.stringify(pkg).includes("50%"));
});
