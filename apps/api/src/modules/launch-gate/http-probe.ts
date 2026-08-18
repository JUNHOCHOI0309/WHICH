import type {
  HealthProbe,
  LaunchGateApiProbe,
  MetaProbe,
  ReconciliationProbe,
} from "./contracts.js";

type JsonObject = Record<string, unknown>;

function objectOrEmpty(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
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
