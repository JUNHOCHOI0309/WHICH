export type LoginProvider = "google" | "x" | "naver" | "kakao";

export function loginHref(provider: LoginProvider, returnTo: string, intent?: "link") {
  const query = new URLSearchParams({ returnTo });
  if (intent) query.set("intent", intent);
  return `/api/auth/${provider}/start?${query}`;
}
