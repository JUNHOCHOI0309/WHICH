import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";
import {
  decodeEntryAttribution,
  encodeEntryAttribution,
  ENTRY_ATTRIBUTION_COOKIE,
  entryAttributionFromSearchParams,
} from "@/lib/server/entry-attribution";

describe("Naver entry attribution", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FLOW_SECRET", "test-auth-flow-secret-with-enough-entropy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes the documented UTM contract without identity or vote data", () => {
    const capturedAt = Date.UTC(2026, 7, 20);
    const attribution = entryAttributionFromSearchParams(
      new URLSearchParams({
        utm_source: " NAVER ",
        utm_medium: "Cafe",
        utm_campaign: "Initial_Issue.Test",
        utm_content: "issue_591f2e90",
      }),
      capturedAt,
    );

    expect(attribution).toEqual({
      version: 1,
      source: "naver",
      medium: "cafe",
      campaign: "initial_issue.test",
      content: "issue_591f2e90",
      capturedAt,
    });
    expect(attribution).not.toHaveProperty("subjectId");
    expect(attribution).not.toHaveProperty("choiceId");
  });

  it("rejects unknown media, duplicate parameters, and unsafe optional values", () => {
    expect(
      entryAttributionFromSearchParams(
        new URLSearchParams("utm_source=naver&utm_medium=instagram"),
      ),
    ).toBeNull();
    expect(
      entryAttributionFromSearchParams(
        new URLSearchParams("utm_source=naver&utm_source=x&utm_medium=cafe"),
      ),
    ).toBeNull();
    expect(
      entryAttributionFromSearchParams(
        new URLSearchParams("utm_source=naver&utm_medium=cafe&utm_campaign=user%40example.com"),
      ),
    ).toBeNull();
  });

  it("rejects a modified or expired signed value", () => {
    const capturedAt = Date.UTC(2026, 7, 20);
    const attribution = entryAttributionFromSearchParams(
      new URLSearchParams("utm_source=naver&utm_medium=choice"),
      capturedAt,
    );
    expect(attribution).not.toBeNull();
    const encoded = encodeEntryAttribution(attribution!);

    expect(decodeEntryAttribution(encoded, capturedAt)).toEqual(attribution);
    expect(decodeEntryAttribution(`${encoded}x`, capturedAt)).toBeNull();
    expect(decodeEntryAttribution(encoded, capturedAt + 31 * 24 * 60 * 60 * 1_000)).toBeNull();
  });

  it("sets a secure first-party HttpOnly cookie for a valid first landing", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(
      new NextRequest(
        "https://whichone.site/issues/591f2e90?utm_source=naver&utm_medium=clip_blog&utm_campaign=launch_v1&utm_content=issue_591f2e90",
      ),
    );

    const cookie = response.cookies.get(ENTRY_ATTRIBUTION_COOKIE);
    expect(cookie).toBeDefined();
    expect(decodeEntryAttribution(cookie?.value)).toMatchObject({
      source: "naver",
      medium: "clip_blog",
      campaign: "launch_v1",
      content: "issue_591f2e90",
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
  });

  it("keeps the original valid attribution instead of overwriting it", () => {
    const first = entryAttributionFromSearchParams(
      new URLSearchParams("utm_source=naver&utm_medium=cafe&utm_campaign=first"),
    );
    expect(first).not.toBeNull();
    const request = new NextRequest(
      "https://whichone.site/?utm_source=naver&utm_medium=homefeed_da&utm_campaign=second",
      {
        headers: {
          cookie: `${ENTRY_ATTRIBUTION_COOKIE}=${encodeEntryAttribution(first!)}`,
        },
      },
    );

    const response = proxy(request);
    expect(response.cookies.get(ENTRY_ATTRIBUTION_COOKIE)).toBeUndefined();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("accepts only complete allowlisted result-share attribution", () => {
    const capturedAt = Date.UTC(2026, 7, 21);
    const shareId = "11111111-1111-4111-8111-111111111111";
    expect(
      entryAttributionFromSearchParams(
        new URLSearchParams(
          `utm_source=share&utm_medium=copy&utm_campaign=result&utm_content=${shareId}`,
        ),
        capturedAt,
      ),
    ).toEqual({
      version: 1,
      source: "share",
      medium: "copy",
      campaign: "result",
      content: shareId,
      capturedAt,
    });
    expect(
      entryAttributionFromSearchParams(
        new URLSearchParams("utm_source=share&utm_medium=email&utm_campaign=result"),
      ),
    ).toBeNull();
    expect(
      entryAttributionFromSearchParams(
        new URLSearchParams(
          "utm_source=share&utm_medium=copy&utm_campaign=result&utm_content=not-a-uuid",
        ),
      ),
    ).toBeNull();
  });

  it("round-trips signed result-share attribution", () => {
    const capturedAt = Date.UTC(2026, 7, 21);
    const attribution = entryAttributionFromSearchParams(
      new URLSearchParams(
        "utm_source=share&utm_medium=system&utm_campaign=result_with_choice&utm_content=11111111-1111-4111-8111-111111111111",
      ),
      capturedAt,
    );
    expect(attribution).not.toBeNull();
    expect(decodeEntryAttribution(encodeEntryAttribution(attribution!), capturedAt)).toEqual(
      attribution,
    );
  });
});
