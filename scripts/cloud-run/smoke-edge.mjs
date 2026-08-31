// Read-only route checks (the normal anonymous feed may create a guest/session).
// Use --origin-ip before DNS cutover; TLS still validates the real hostname.
import https from "node:https";
import { isIP } from "node:net";

const args = process.argv.slice(2);
const host = "whichone.site";
const originIp = args[0] === "--origin-ip" ? args[1] : undefined;
if (args.length && (args.length !== 2 || !originIp || isIP(originIp) !== 4)) {
  throw new Error("Usage: node scripts/cloud-run/smoke-edge.mjs [--origin-ip IPv4]");
}

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: originIp ?? host,
        servername: host,
        path,
        headers: { host, ...headers },
        timeout: 25_000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (part) => {
          body += part;
          if (body.length > 4_000_000) response.destroy(new Error("Response exceeds smoke limit"));
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({ status: response.statusCode, body, location: response.headers.location }),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error("Smoke request timed out")));
    request.on("error", reject);
  });
}

const checks = [
  ["/api/health", [200]],
  ["/", [200]],
  ["/api/issues/feed", [200]],
  ["/api/me", [401]],
  // The public Cloudflare edge can redirect to Access; the origin must reject.
  ["/api/ops/members", originIp ? [403] : [302, 403]],
];
for (const [path, expected] of checks) {
  const result = await get(path);
  const ok = expected.includes(result.status);
  console.log(JSON.stringify({ path, status: result.status, ok }));
  if (!ok) process.exitCode = 1;
  if (path === "/api/health" && result.status === 200 && JSON.parse(result.body).status !== "ok") {
    throw new Error("Health response is not ready");
  }
  if (path === "/" && result.status === 200) {
    const assets = [...result.body.matchAll(/(?:src|href)="(\/_next\/static\/[^" ]+)"/g)];
    const paths = [...new Set(assets.map((match) => match[1]))].slice(0, 3);
    if (paths.length < 2) throw new Error("Static assets missing from home page");
    for (const asset of paths) {
      const assetResult = await get(asset);
      console.log(JSON.stringify({ asset, status: assetResult.status }));
      if (assetResult.status !== 200) process.exitCode = 1;
    }
  }
}
// Only begin a temporary authorization flow; never follow it, log tokens, or sign in.
for (const [provider, authority] of [
  ["google", "accounts.google.com"],
  ["kakao", "kauth.kakao.com"],
  ["naver", "nid.naver.com"],
  ["x", "x.com"],
]) {
  const result = await get(`/api/auth/${provider}/start`);
  const location = result.location ? new URL(result.location) : null;
  const callback = location?.searchParams.get("redirect_uri");
  const ok =
    [302, 307].includes(result.status) &&
    location?.hostname === authority &&
    callback === `https://${host}/api/auth/${provider}/callback`;
  console.log(JSON.stringify({ check: "oauth-start", provider, status: result.status, ok }));
  if (!ok) process.exitCode = 1;
}
if (originIp) {
  const result = await get("/api/ops/members", { "cf-access-jwt-assertion": "invalid-test-token" });
  const ok = result.status === 403;
  console.log(JSON.stringify({ check: "forged-access-token-rejected", status: result.status, ok }));
  if (!ok) process.exitCode = 1;
}
