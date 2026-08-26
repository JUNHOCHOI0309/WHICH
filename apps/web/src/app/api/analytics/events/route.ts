import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { decodeEntryAttribution, ENTRY_ATTRIBUTION_COOKIE } from "@/lib/server/entry-attribution";
import { analyticsContextForRequest } from "@/lib/server/analytics-context";
import {
  analyticsSessionForRequest,
  setAnalyticsSessionCookie,
} from "@/lib/server/analytics-session";
import { internalAuthSecret } from "@/lib/server/member-auth";
import { fetchWhichApi } from "@/lib/server/which-api";

type EventBody = {
  eventId?: string;
  eventType?: string;
  issueId?: string;
  issueVersion?: number;
  occurredAt?: string;
  recommendationRequestId?: string;
  shareCardId?: string;
  quality?: {
    durationMs?: number;
    canonicalChoiceId?: string;
    shownPosition?: number;
    mediaMode?: string;
    mediaLoadOutcome?: string;
  };
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EventBody;
    const session = analyticsSessionForRequest(request);
    const attribution = decodeEntryAttribution(
      request.cookies.get(ENTRY_ATTRIBUTION_COOKIE)?.value,
    );
    const safeAttribution = attribution
      ? {
          source: attribution.source,
          medium: attribution.medium,
          campaign: attribution.campaign,
          content: attribution.content,
          capturedAt: new Date(attribution.capturedAt).toISOString(),
        }
      : undefined;
    const upstream = await fetchWhichApi("/v1/internal/analytics/events", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-internal-auth-secret": internalAuthSecret(),
      },
      body: JSON.stringify({
        eventId: body.eventId,
        eventType: body.eventType,
        issueId: body.issueId,
        issueVersion: body.issueVersion,
        occurredAt: body.occurredAt,
        recommendationRequestId: body.recommendationRequestId,
        shareCardId: body.shareCardId,
        quality: body.quality
          ? {
              durationMs: body.quality.durationMs,
              canonicalChoiceId: body.quality.canonicalChoiceId,
              shownPosition: body.quality.shownPosition,
              mediaMode: body.quality.mediaMode,
              mediaLoadOutcome: body.quality.mediaLoadOutcome,
            }
          : undefined,
        sessionId: session.id,
        context: analyticsContextForRequest(request, Boolean(safeAttribution)),
        ...(safeAttribution ? { attribution: safeAttribution } : {}),
      }),
    });
    const responseBody = (await upstream.json()) as unknown;
    const response = NextResponse.json(responseBody, { status: upstream.status });
    setAnalyticsSessionCookie(response, session);
    return response;
  } catch {
    return NextResponse.json(
      { code: "ANALYTICS_UNAVAILABLE", message: "측정 이벤트를 기록하지 못했습니다." },
      { status: 502 },
    );
  }
}
