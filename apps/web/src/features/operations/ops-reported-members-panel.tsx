"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { OpsReportedMembersPage } from "./contracts";
import styles from "./ops-management.module.css";

type AccessState = "" | "OPEN" | "LIMITED" | "BLOCKED";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function OpsReportedMembersPanel({ onOpenModeration }: { onOpenModeration: () => void }) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [state, setState] = useState<AccessState>("");
  const [page, setPage] = useState<OpsReportedMembersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (state) params.set("state", state);
      if (submittedQuery) params.set("q", submittedQuery);
      const response = await fetch(`/api/ops/reported-members?${params}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as OpsReportedMembersPage & { message?: string };
      if (!response.ok) throw new Error(body.message || "신고 계정 목록을 불러오지 못했습니다.");
      setPage(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "신고 계정 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [state, submittedQuery]);

  useEffect(() => {
    // State updates happen after the bounded operator request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery === submittedQuery) void load();
    else setSubmittedQuery(nextQuery);
  }

  return (
    <section className={styles.page} aria-labelledby="reported-members-title">
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>REPORT-BASED ACCESS</p>
          <h1 id="reported-members-title">신고 계정 관리</h1>
        </div>
        <button type="button" className={styles.provider} onClick={onOpenModeration}>
          신고 검토 큐 열기
        </button>
      </div>
      <div className={styles.notice}>
        유효 신고만 집계합니다. 7일 동안 3명·2개 질문이면 작성 빈도가 제한되고, 14일 동안 5명·3개
        질문이면 마지막 신고부터 72시간 동안 새 질문과 업로드가 차단됩니다.
      </div>
      <form className={styles.filters} onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="닉네임 또는 Member UUID"
          maxLength={80}
        />
        <select value={state} onChange={(event) => setState(event.target.value as AccessState)}>
          <option value="">모든 제한 상태</option>
          <option value="BLOCKED">작성 차단</option>
          <option value="LIMITED">작성 제한</option>
          <option value="OPEN">현재 제한 없음</option>
        </select>
        <button type="submit">조회</button>
      </form>
      {error ? (
        <p className={styles.feedback} data-error="true">
          {error}
        </p>
      ) : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>회원</th>
              <th>질문 작성 상태</th>
              <th>최근 7일</th>
              <th>최근 14일</th>
              <th>최근 신고</th>
              <th>계정 상태</th>
            </tr>
          </thead>
          <tbody>
            {page?.items.map((member) => (
              <tr key={member.memberId}>
                <td>
                  <div className={styles.identity}>
                    <strong>{member.displayName}</strong>
                    <code>{member.memberId}</code>
                  </div>
                </td>
                <td>
                  <strong>{member.issueAccess.state}</strong>
                  <br />
                  <small>
                    {member.issueAccess.restrictedUntil
                      ? `${dateTime(member.issueAccess.restrictedUntil)}까지`
                      : member.issueAccess.canCreateNow
                        ? "지금 작성 가능"
                        : "현재 작성 불가"}
                  </small>
                </td>
                <td>
                  신고 {member.reports7d} · 신고자 {member.uniqueReporters7d}
                  <br />
                  <small>대상 질문 {member.reportedTargets7d}</small>
                </td>
                <td>
                  신고 {member.reports14d} · 신고자 {member.uniqueReporters14d}
                  <br />
                  <small>대상 질문 {member.reportedTargets14d}</small>
                </td>
                <td>{dateTime(member.latestReportAt)}</td>
                <td>{member.memberStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !page?.items.length ? (
        <div className={styles.empty}>조건에 맞는 신고 계정이 없습니다.</div>
      ) : null}
    </section>
  );
}
