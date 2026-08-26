import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { internalAuthSecret } from "@/lib/server/member-auth";
import { mobileAnalyticsContextForRequest } from "@/lib/server/analytics-context";
import { fetchWhichApi, validGuestSubject } from "@/lib/server/which-api";

export async function POST(request: NextRequest) {
  const sessionId = validGuestSubject(request.headers.get("x-analytics-session-id") ?? undefined);
  if (!sessionId) {
    return NextResponse.json(
      { code: "INVALID_ANALYTICS_SESSION", message: "측정 Session이 필요합니다." },
      { status: 400 },
    );
  }
  try {
    const event = (await request.json()) as {
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
    const upstream = await fetchWhichApi("/v1/internal/analytics/events", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-internal-auth-secret": internalAuthSecret(),
      },
      body: JSON.stringify({
        eventId: event.eventId,
        eventType: event.eventType,
        issueId: event.issueId,
        issueVersion: event.issueVersion,
        occurredAt: event.occurredAt,
        recommendationRequestId: event.recommendationRequestId,
        shareCardId: event.shareCardId,
        quality: event.quality
          ? {
              durationMs: event.quality.durationMs,
              canonicalChoiceId: event.quality.canonicalChoiceId,
              shownPosition: event.quality.shownPosition,
              mediaMode: event.quality.mediaMode,
              mediaLoadOutcome: event.quality.mediaLoadOutcome,
            }
          : undefined,
        sessionId,
        context: mobileAnalyticsContextForRequest(request),
      }),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch {
    return NextResponse.json(
      { code: "ANALYTICS_UNAVAILABLE", message: "측정 이벤트를 기록하지 못했습니다." },
      { status: 502 },
    );
  }
}
