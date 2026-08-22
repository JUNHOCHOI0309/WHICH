export type LoginProvider = "google" | "x" | "naver" | "kakao";

export function loginHref(provider: LoginProvider, returnTo: string) {
  return `/api/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
}
