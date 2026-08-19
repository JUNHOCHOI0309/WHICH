export type LoginProvider = "google" | "x";

export function loginHref(provider: LoginProvider, returnTo: string) {
  return `/api/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;
}
