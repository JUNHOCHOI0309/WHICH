import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

export class CloudflareAccessError extends Error {
  constructor(
    public readonly code: "CF_ACCESS_MISCONFIGURED" | "CF_ACCESS_REQUIRED" | "CF_ACCESS_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CloudflareAccessError";
  }
}

let cachedJwks: { issuer: string; value: ReturnType<typeof createRemoteJWKSet> } | undefined;

function accessConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const teamDomain = environment.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, "");
  const audience = environment.CF_ACCESS_AUD?.trim();
  if (!teamDomain && !audience) return null;
  if (!teamDomain || !audience) {
    throw new CloudflareAccessError(
      "CF_ACCESS_MISCONFIGURED",
      "Cloudflare Access team domain and audience must be configured together.",
    );
  }
  const url = new URL(teamDomain);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com")) {
    throw new CloudflareAccessError(
      "CF_ACCESS_MISCONFIGURED",
      "Cloudflare Access team domain must be an HTTPS cloudflareaccess.com origin.",
    );
  }
  return { issuer: url.origin, audience };
}

export async function verifyCloudflareAccess(request: NextRequest) {
  const configuration = accessConfiguration();
  if (!configuration) return { enabled: false as const, email: null };
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    throw new CloudflareAccessError(
      "CF_ACCESS_REQUIRED",
      "A valid Cloudflare Access session is required.",
    );
  }
  cachedJwks =
    cachedJwks?.issuer === configuration.issuer
      ? cachedJwks
      : {
          issuer: configuration.issuer,
          value: createRemoteJWKSet(new URL(`${configuration.issuer}/cdn-cgi/access/certs`)),
        };
  try {
    const { payload } = await jwtVerify(token, cachedJwks.value, {
      issuer: configuration.issuer,
      audience: configuration.audience,
    });
    return {
      enabled: true as const,
      email: typeof payload.email === "string" ? payload.email : null,
    };
  } catch {
    throw new CloudflareAccessError(
      "CF_ACCESS_INVALID",
      "The Cloudflare Access assertion is invalid or expired.",
    );
  }
}
