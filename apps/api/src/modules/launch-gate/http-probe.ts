import type {
  HealthProbe,
  LaunchGateApiProbe,
  MetaProbe,
  OAuthStartProbe,
  PublicFeedProbe,
  PublicHomeProbe,
  PublicIssueProbe,
  PublicNextIssueProbe,
  PublicWebProbe,
  ReconciliationProbe,
} from "./contracts.js";

type JsonObject = Record<string, unknown>;

const PUBLIC_PROBE_GUEST_SUBJECT = "00000000-0000-4000-8000-000000000051";

function objectOrEmpty(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}

export function createHttpPublicWebProbe(options: {
  publicWebUrl: string;
  timeoutMilliseconds?: number;
  fetchImplementation?: typeof fetch;
}): PublicWebProbe {
  const request = options.fetchImplementation ?? fetch;
  const baseUrl = new URL(options.publicWebUrl);
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;

  async function call(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("cookie", `which_guest_subject=${PUBLIC_PROBE_GUEST_SUBJECT}`);
    return request(new URL(path, baseUrl), {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  }

  async function page(path: string): Promise<PublicHomeProbe> {
    const response = await call(path);
    const contentType = response.headers.get("content-type") ?? "";
    return { statusCode: response.status, isHtml: contentType.includes("text/html") };
  }

  async function feed(path: string): Promise<PublicFeedProbe & { firstIssueId: string | null }> {
    const response = await call(path);
    const body = await responseJson(response);
    const items: unknown[] | null = Array.isArray(body.items) ? body.items : null;
    const firstItem = items?.[0];
    const issue = objectOrEmpty(firstItem);
    return {
      statusCode: response.status,
      itemCount: items?.length ?? null,
      firstIssueId: stringOrNull(issue.id) ?? stringOrNull(issue.issueId),
    };
  }

  async function oauthStart(path: string): Promise<OAuthStartProbe> {
    const response = await call(path, { redirect: "manual" });
    const location = response.headers.get("location");
    let providerHost: string | null = null;
    if (location) {
      try {
        providerHost = new URL(location, baseUrl).hostname;
      } catch {
        providerHost = null;
      }
    }
    return { statusCode: response.status, providerHost };
  }

  return {
    home: () => page("/"),
    async feed(): Promise<PublicFeedProbe> {
      const result = await feed("/api/issues/feed?limit=1");
      return { statusCode: result.statusCode, itemCount: result.itemCount };
    },
    async issueDeepLink(): Promise<PublicIssueProbe> {
      const first = await feed("/api/issues/feed?limit=1");
      if (first.statusCode !== 200 || !first.firstIssueId) {
        return { statusCode: first.statusCode, isHtml: false, issueId: first.firstIssueId };
      }
      const result = await page(`/issues/${encodeURIComponent(first.firstIssueId)}`);
      return {
        ...result,
        issueId: first.firstIssueId,
      };
    },
    async nextIssue(): Promise<PublicNextIssueProbe> {
      const first = await feed("/api/issues/feed?limit=1");
      if (first.statusCode !== 200 || !first.firstIssueId) {
        return {
          statusCode: first.statusCode,
          itemCount: first.itemCount,
          excludedIssueId: first.firstIssueId,
          returnedIssueId: null,
        };
      }
      const next = await feed(
        `/api/issues/feed?limit=1&excludeIssueId=${encodeURIComponent(first.firstIssueId)}`,
      );
      return {
        statusCode: next.statusCode,
        itemCount: next.itemCount,
        excludedIssueId: first.firstIssueId,
        returnedIssueId: next.firstIssueId,
      };
    },
    async mobileFeed(): Promise<PublicFeedProbe> {
      const result = await feed("/api/mobile/v1/issues/feed?limit=1");
      return { statusCode: result.statusCode, itemCount: result.itemCount };
    },
    login: () => page("/login"),
    signup: () => page("/signup"),
    passwordRecovery: () => page("/forgot-password"),
    memberCenter: () => page("/me"),
    privacyPolicy: () => page("/legal/privacy"),
    termsOfService: () => page("/legal/terms"),
    googleOAuthStart: () => oauthStart("/api/auth/google/start"),
    xOAuthStart: () => oauthStart("/api/auth/x/start"),
    naverOAuthStart: () => oauthStart("/api/auth/naver/start"),
    kakaoOAuthStart: () => oauthStart("/api/auth/kakao/start"),
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function responseJson(response: Response) {
  try {
    return objectOrEmpty(await response.json());
  } catch {
    return {};
  }
}

export function createHttpLaunchGateProbe(options: {
  apiBaseUrl: string;
  internalAuthSecret: string;
  issueId: string;
  issueVersion: number;
  timeoutMilliseconds?: number;
  fetchImplementation?: typeof fetch;
}): LaunchGateApiProbe {
  const request = options.fetchImplementation ?? fetch;
  const baseUrl = new URL(options.apiBaseUrl);
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000;

  async function call(path: string, init?: RequestInit) {
    return request(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  }

  async function health(path: string): Promise<HealthProbe> {
    const response = await call(path);
    const body = await responseJson(response);
    return {
      statusCode: response.status,
      status: stringOrNull(body.status),
      service: stringOrNull(body.service),
    };
  }

  return {
    live: () => health("/health/live"),
    ready: () => health("/health/ready"),
    async meta(): Promise<MetaProbe> {
      const response = await call("/v1/meta");
      const body = await responseJson(response);
      const featureFlags = objectOrEmpty(body.featureFlags);
      const booleanFlags = Object.fromEntries(
        Object.entries(featureFlags).filter((entry): entry is [string, boolean] => {
          return typeof entry[1] === "boolean";
        }),
      );
      return {
        statusCode: response.status,
        service: stringOrNull(body.service),
        version: stringOrNull(body.version),
        releaseId: stringOrNull(body.releaseId),
        featureFlags: Object.keys(booleanFlags).length > 0 ? booleanFlags : null,
      };
    },
    async reconcile(): Promise<ReconciliationProbe> {
      const response = await call(
        `/v1/internal/issues/${options.issueId}/versions/${options.issueVersion}/vote-reconciliation`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-auth-secret": options.internalAuthSecret,
          },
          body: JSON.stringify({ mode: "DRY_RUN" }),
        },
      );
      const body = await responseJson(response);
      return {
        statusCode: response.status,
        mode: stringOrNull(body.mode),
        status: stringOrNull(body.status),
        mismatchCount: Array.isArray(body.mismatches) ? body.mismatches.length : null,
      };
    },
  };
}
