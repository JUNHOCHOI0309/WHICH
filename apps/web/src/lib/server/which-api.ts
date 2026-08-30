import type { NextRequest, NextResponse } from "next/server";

import type { ApiErrorBody } from "../contracts";
import { SOCIAL_SIGNUP_COOKIE } from "./member-auth";

export const GUEST_SUBJECT_COOKIE = "which_guest_subject";
export const MEMBER_SESSION_COOKIE = "which_member_session";

const anonymousSubjectPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function secureAuthCookie() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.AUTH_BASE_URL?.startsWith("https://") === true
  );
}

function apiBaseUrl() {
  const configured = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  const renderPrivateHostport = process.env.WHICH_API_HOSTPORT;
  const baseUrl =
    configured ??
    (renderPrivateHostport ? `http://${renderPrivateHostport}` : "http://localhost:4000");
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function fetchWhichApi(path: string, init?: RequestInit) {
  return fetch(new URL(path.replace(/^\//, ""), apiBaseUrl()), {
    ...init,
    cache: "no-store",
  });
}

export function validGuestSubject(value: string | undefined) {
  return value && anonymousSubjectPattern.test(value) ? value : null;
}

export async function createGuestSubject() {
  const upstream = await fetchWhichApi("/v1/guest-subjects", {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const body = (await upstream.json()) as { anonymousSubjectId?: string } & ApiErrorBody;
  const anonymousSubjectId = validGuestSubject(body.anonymousSubjectId);

  if (!upstream.ok || !anonymousSubjectId) {
    throw new Error(body.message || "Guest Subject를 준비하지 못했습니다.");
  }

  return anonymousSubjectId;
}

export function setGuestSubjectCookie(response: NextResponse, anonymousSubjectId: string) {
  response.cookies.set({
    name: GUEST_SUBJECT_COOKIE,
    value: anonymousSubjectId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function clearGuestSubjectCookie(response: NextResponse) {
  response.cookies.set({
    name: GUEST_SUBJECT_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function setSocialSignupCookie(response: NextResponse, ticket: string) {
  response.cookies.set({
    name: SOCIAL_SIGNUP_COOKIE,
    value: ticket,
    httpOnly: true,
    sameSite: "lax",
    secure: secureAuthCookie(),
    path: "/",
    maxAge: 10 * 60,
  });
}

export function clearSocialSignupCookie(response: NextResponse) {
  response.cookies.set({
    name: SOCIAL_SIGNUP_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureAuthCookie(),
    path: "/",
    maxAge: 0,
  });
}

export function setMemberSessionCookie(response: NextResponse, token: string, expiresAt: string) {
  response.cookies.set({
    name: MEMBER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureAuthCookie(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearMemberSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: MEMBER_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureAuthCookie(),
    path: "/",
    maxAge: 0,
  });
}

export async function interestIdentityForRequest(request: NextRequest) {
  const sessionToken = request.cookies.get(MEMBER_SESSION_COOKIE)?.value;
  let anonymousSubjectId = validGuestSubject(request.cookies.get(GUEST_SUBJECT_COOKIE)?.value);
  let createdGuest = false;

  if (!sessionToken && !anonymousSubjectId) {
    anonymousSubjectId = await createGuestSubject();
    createdGuest = true;
  }

  return {
    anonymousSubjectId,
    sessionToken,
    createdGuest,
    headers: {
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...(anonymousSubjectId ? { "x-anonymous-subject-id": anonymousSubjectId } : {}),
    },
  };
}
