export const MEMBER_LOGOUT_ERROR = "로그아웃하지 못했습니다. 다시 시도해 주세요.";

export async function logoutMemberSession() {
  const response = await fetch("/api/member-session", {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "x-which-csrf": "member-session-logout" },
  });

  if (response.status !== 204) {
    throw new Error(MEMBER_LOGOUT_ERROR);
  }
}
