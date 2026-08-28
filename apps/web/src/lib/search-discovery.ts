import type { Metadata } from "next";

import type { PublicIssue } from "@/lib/contracts";

export const SITE_NAME = "WHICH";
export const SITE_DESCRIPTION =
  "일상의 선택부터 사회적 질문까지, 먼저 고른 뒤 사람들의 결과와 이유를 확인하는 선택 플랫폼.";

export function siteOrigin() {
  const configured = process.env.AUTH_BASE_URL ?? "https://whichone.site";
  return new URL(configured.endsWith("/") ? configured : `${configured}/`);
}

export function canonicalUrl(pathname: string) {
  return new URL(pathname.replace(/^\/?/, "/"), siteOrigin()).toString();
}

export function issueCanonicalPath(issueId: string) {
  return `/issues/${encodeURIComponent(issueId)}`;
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

export function issueSearchDescription(issue: PublicIssue) {
  const choices = issue.choices
    .slice(0, 4)
    .map((choice) => `${choice.code}. ${compactWhitespace(choice.label)}`)
    .join(" · ");
  const context = issue.context ? compactWhitespace(issue.context) : "당신의 선택은 어느 쪽인가요?";
  return truncate(`${context} ${choices}. 먼저 선택한 뒤 결과를 확인하세요.`, 155);
}

export function issueIsIndexable(issue: Pick<PublicIssue, "question" | "context" | "choices">) {
  const question = compactWhitespace(issue.question);
  const context = compactWhitespace(issue.context ?? "");
  const labels = issue.choices.map((choice) => compactWhitespace(choice.label));
  const combinedLength = [question, context, ...labels].join(" ").length;
  return (
    question.length >= 10 &&
    context.length >= 12 &&
    combinedLength >= 36 &&
    issue.choices.length === 2 &&
    labels.every((label) => label.length >= 2) &&
    new Set(labels.map((label) => label.toLocaleLowerCase("ko-KR"))).size === labels.length
  );
}

export function privatePageMetadata(title: string, description?: string): Metadata {
  return {
    title,
    ...(description ? { description } : {}),
    robots: { index: false, follow: false, nocache: true },
  };
}

export function serializeStructuredData(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
