export type LoginProvider = "google" | "x" | "naver" | "kakao" | "tiktok";
export type RecentLoginProvider = LoginProvider | "email";

const recentLoginProviders = new Set<RecentLoginProvider>([
  "email",
  "google",
  "x",
  "naver",
  "kakao",
  "tiktok",
]);

export function parseRecentLoginProvider(value: string | null | undefined) {
  return value && recentLoginProviders.has(value as RecentLoginProvider)
    ? (value as RecentLoginProvider)
    : null;
}

export function loginHref(provider: LoginProvider, returnTo: string, intent?: "link") {
  const query = new URLSearchParams({ returnTo });
  if (intent) query.set("intent", intent);
  return `/api/auth/${provider}/start?${query}`;
}
