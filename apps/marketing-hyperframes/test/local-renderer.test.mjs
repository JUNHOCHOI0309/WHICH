import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedOrigin,
  corsHeaders,
  downloadName,
  validateRenderPayload,
} from "../scripts/local-renderer.mjs";

test("local renderer accepts only the WHICH studio and local development origins", () => {
  assert.equal(allowedOrigin("https://studio.whichone.site"), true);
  assert.equal(allowedOrigin("https://8df7db57.which-marketing-studio-pages.pages.dev"), true);
  assert.equal(allowedOrigin("http://127.0.0.1:8772"), true);
  assert.equal(allowedOrigin("https://attacker.example"), false);
  assert.equal(
    corsHeaders("https://studio.whichone.site")["access-control-allow-private-network"],
    "true",
  );
});

test("local renderer validates fixed WHICH composition variables", () => {
  const id = "a".repeat(64);
  const parsed = validateRenderPayload({
    id,
    variables: {
      question: "오늘 하나만 고른다면?",
      context: "같은 비용이라고 가정해 주세요.",
      choiceA: "산책",
      choiceB: "집에서 휴식",
      cta: "먼저 고르고 결과를 확인하세요",
      url: "https://whichone.site/issues/00000000-0000-4000-8000-000000000001",
    },
  });
  assert.equal(parsed.id, id);
  assert.equal(downloadName(id), "which-short-aaaaaaaa-5s.mp4");
  assert.throws(
    () =>
      validateRenderPayload({
        ...parsed,
        variables: { ...parsed.variables, url: "https://evil.example" },
      }),
    /INVALID_VARIABLE_URL/,
  );
});
