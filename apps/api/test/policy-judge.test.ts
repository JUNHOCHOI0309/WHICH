import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  createLunaJudgeAdapter,
  prepareJudgeRequest,
  reconcileLowSexualDisagreement,
} from "../src/modules/policy-judge/adapter.js";
import {
  judgeCosts,
  judgeDiagnostic,
  POLICY_JUDGE_MODEL,
  POLICY_JUDGE_PROFILE,
  policyJudgeConfig,
  sampleBucket,
} from "../src/modules/policy-judge/contracts.js";
import {
  clearDecision,
  judgeConfig,
  pairInput,
  providerConfig,
} from "./helpers/policy-judge-fixtures.js";

function response(overrides: Record<string, unknown> = {}) {
  return {
    model: POLICY_JUDGE_MODEL,
    status: "completed",
    usage: { input_tokens: 1200, output_tokens: 150, input_tokens_details: { cached_tokens: 200 } },
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(clearDecision) }],
      },
    ],
    ...overrides,
  };
}

describe("Luna pair policy Shadow", () => {
  it("defaults off and requires separate Responses approval plus existing privacy/key/kill gates", () => {
    expect(judgeDiagnostic(policyJudgeConfig({}), providerConfig())).toMatchObject({
      allowed: false,
      reason: "MODE_OFF",
      publicationChanged: false,
    });
    expect(judgeDiagnostic(judgeConfig(), providerConfig()).allowed).toBe(true);
    expect(
      judgeDiagnostic(
        { ...judgeConfig(), MODERATION_POLICY_JUDGE_RESPONSES_APPROVED: false },
        providerConfig(),
      ).reason,
    ).toBe("RESPONSES_APPROVAL_REQUIRED");
    expect(
      judgeDiagnostic(judgeConfig(), { ...providerConfig(), MODERATION_PROVIDER_KILL_SWITCH: true })
        .allowed,
    ).toBe(false);
    expect(
      judgeDiagnostic(
        { ...judgeConfig(), MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP: 0 },
        providerConfig(),
      ).reason,
    ).toBe("BUDGET_ZERO");
    expect(
      judgeDiagnostic(judgeConfig(), {
        ...providerConfig(),
        evidence: { ...providerConfig().evidence, dpaExecuted: false },
      }).allowed,
    ).toBe(false);
  });
  it("creates one non-stored, no-reasoning request with two 512px low-detail images", async () => {
    const input = await pairInput();
    const prepared = await prepareJudgeRequest(input, "policy1");
    expect(prepared.body).toMatchObject({
      model: POLICY_JUDGE_MODEL,
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: 384,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(POLICY_JUDGE_PROFILE).toBe("which-luna-review-v6");
    expect(prepared.body.instructions).toContain(
      "Ordinary non-explicit swimwear, beachwear, sportswear and fashion images are not SEXUAL by themselves.",
    );
    expect(prepared.body.instructions).toContain(
      "Do not use SEXUAL solely because an image shows legs, shoulders, midriff, cleavage, a tight or high-cut garment, or a conventional fashion pose.",
    );
    expect(prepared.body.instructions).toContain(
      "Use SEXUAL for explicit nudity, visible genitals, anus or nipples, sexual acts, pornographic or fetish framing, or clearly sexualized focus on intimate areas.",
    );
    const sent = prepared.body.input as Array<{
      content: Array<{ type: string; image_url?: string; detail?: string }>;
    }>;
    expect(sent[0]!.content.filter((c) => c.type === "input_image")).toHaveLength(2);
    for (const item of sent[0]!.content.slice(1)) {
      expect(item.detail).toBe("low");
      const info = await sharp(Buffer.from(item.image_url!.split(",")[1]!, "base64")).metadata();
      expect(info.width).toBe(512);
      expect(info.height).toBe(384);
      expect(info.exif).toBeUndefined();
    }
    expect(prepared.reservedMicros).toBeGreaterThan(0);
    expect(input.images![0]!.width).toBe(1024);
  });
  it("clears only a low OpenAI image-sexual disagreement with otherwise safe Luna fields", () => {
    const review = {
      ...clearDecision,
      decision: "REVIEW" as const,
      reason_codes: ["SEXUAL" as const],
      needs_human: true,
    };
    const lowSignal = {
      providerLabel: "sexual",
      rawScore: 0.003,
      flagged: false,
      calibratedBand: "LOW",
      appliedModalities: ["TEXT", "IMAGE"],
    };
    expect(reconcileLowSexualDisagreement(review, [lowSignal])).toMatchObject({
      reconciled: true,
      decision: { decision: "ALLOW", reason_codes: ["NONE"], needs_human: false },
    });
    for (const blocked of [
      { decision: review, signals: [{ ...lowSignal, rawScore: 0.011 }] },
      { decision: review, signals: [{ ...lowSignal, flagged: true }] },
      {
        decision: { ...review, reason_codes: ["SEXUAL" as const, "SPAM" as const] },
        signals: [lowSignal],
      },
      { decision: { ...review, pair_fairness: "UNBALANCED" as const }, signals: [lowSignal] },
    ])
      expect(reconcileLowSexualDisagreement(blocked.decision, blocked.signals).reconciled).toBe(
        false,
      );
  });
  it("binds cache to ordered images, question, OCR, and policy, never asset-only inputs", async () => {
    const input = await pairInput();
    const first = await prepareJudgeRequest(input, "p1");
    expect((await prepareJudgeRequest(input, "p1")).cacheKey).toBe(first.cacheKey);
    for (const changed of [
      { ...input, context: { ...input.context!, question: "누가 못생겼나요?" } },
      { ...input, text: "different OCR" },
      {
        ...input,
        embeddedText: { ...input.embeddedText!, images: [...input.embeddedText!.images].reverse() },
      },
    ])
      expect((await prepareJudgeRequest(changed, "p1")).cacheKey).not.toBe(first.cacheKey);
    expect((await prepareJudgeRequest(input, "p2")).cacheKey).not.toBe(first.cacheKey);
    await expect(prepareJudgeRequest({ ...input, scope: "ASSET_ONLY" }, "p1")).rejects.toThrow();
    await expect(
      prepareJudgeRequest({ ...input, images: [input.images![0]!] }, "p1"),
    ).rejects.toThrow();
  });
  it.each(["PARTIAL", "UNAVAILABLE", "WITHHELD_PII"] as const)(
    "will not send %s OCR evidence",
    async (status) => {
      const input = await pairInput();
      input.embeddedText!.images[0]!.status = status;
      await expect(prepareJudgeRequest(input, "p")).rejects.toThrow();
    },
  );
  it("rejects external image URLs and oversized context", async () => {
    const input = await pairInput();
    await expect(
      prepareJudgeRequest(
        {
          ...input,
          images: input.images!.map((i) => ({ ...i, dataUrl: "https://private.test/image" })),
        },
        "p",
      ),
    ).rejects.toThrow();
    await expect(
      prepareJudgeRequest({ ...input, text: "x".repeat(40_000) }, "p"),
    ).rejects.toThrow();
  });
  it("captures actual usage and only validated label output", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response())));
    const call = createLunaJudgeAdapter({ apiKey: "fixture", timeoutMs: 1000, fetch: mock });
    const result = await call(await prepareJudgeRequest(await pairInput(), "p"));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]![0]).toBe("https://api.openai.com/v1/responses");
    expect(result.decision).toEqual(clearDecision);
    expect(judgeCosts(result.usage!)).toEqual({ costMicros: 384, chargedMicros: 480 });
    expect(JSON.stringify(result)).not.toContain("fixture");
  });
  it.each([
    ["RESPONSE_INCOMPLETE", { status: "incomplete" }],
    ["USAGE_MISSING", { usage: null }],
    ["MODEL_MISMATCH", { model: "different-model" }],
    [
      "REFUSAL",
      {
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "refusal" }],
          },
        ],
      },
    ],
    [
      "SCHEMA_INVALID",
      {
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ ...clearDecision, explanation: "private leaked OCR" }),
              },
            ],
          },
        ],
      },
    ],
  ] as const)("fails closed on %s", async (reason, overrides) => {
    const call = createLunaJudgeAdapter({
      apiKey: "fixture",
      timeoutMs: 1000,
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(response(overrides)))),
    });
    const result = await call(await prepareJudgeRequest(await pairInput(), "p"));
    expect(result).toMatchObject({ reason, decision: null });
    expect(JSON.stringify(result)).not.toContain("private leaked OCR");
  });
  it("downgrades a contradictory ALLOW to an explicit human review", async () => {
    const call = createLunaJudgeAdapter({
      apiKey: "fixture",
      timeoutMs: 1000,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify(
            response({
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({ ...clearDecision, privacy_risk: "UNCERTAIN" }),
                    },
                  ],
                },
              ],
            }),
          ),
        ),
      ),
    });
    const result = await call(await prepareJudgeRequest(await pairInput(), "p"));
    expect(result).toMatchObject({
      reason: "INCONSISTENT_ALLOW_DOWNGRADED",
      decision: {
        decision: "REVIEW",
        reason_codes: ["PRIVACY"],
        privacy_risk: "UNCERTAIN",
        needs_human: true,
      },
    });
  });
  it("retains unknown usage for network/HTTP errors without retry or leaking errors", async () => {
    const request = await prepareJudgeRequest(await pairInput(), "p");
    for (const mock of [
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException("secret", "TimeoutError")),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("secret", { status: 429 })),
    ]) {
      const result = await createLunaJudgeAdapter({
        apiKey: "fixture",
        timeoutMs: 1000,
        fetch: mock,
      })(request);
      expect(result.usage).toBeNull();
      expect(result.decision).toBeNull();
      expect(mock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
  it("sampling is deterministic and separately salted for audits", () => {
    const values = Array.from({ length: 200 }, (_, i) => sampleBucket(String(i), "audit"));
    expect(values.every((v) => v >= 0 && v < 100)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(50);
    expect(sampleBucket("hash", "audit")).toBe(sampleBucket("hash", "audit"));
  });
});
