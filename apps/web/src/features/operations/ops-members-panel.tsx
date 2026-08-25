"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { OpsMemberPage, OpsMemberRecord, OpsMemberStatus } from "./contracts";
import styles from "./ops-management.module.css";

function dateTime(value: string | null) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function OpsMembersPanel() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [status, setStatus] = useState<OpsMemberStatus | "">("");
  const [items, setItems] = useState<OpsMemberRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (append = false, nextCursor?: string | null) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: "25" });
        if (status) params.set("status", status);
        if (submittedQuery) params.set("q", submittedQuery);
        if (nextCursor) params.set("cursor", nextCursor);
        const response = await fetch(`/api/ops/members?${params}`, { cache: "no-store" });
        const body = (await response.json()) as OpsMemberPage & { message?: string };
        if (!response.ok) throw new Error(body.message || "사용자 DB를 불러오지 못했습니다.");
        setItems((current) => (append ? [...current, ...body.items] : body.items));
        setCursor(body.nextCursor);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "사용자 DB를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [status, submittedQuery],
  );

  useEffect(() => {
    // The state changes happen after the bounded operator request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  return (
    <section className={styles.page}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>MEMBER DIRECTORY</p>
          <h1>사용자 DB</h1>
        </div>
        <span>민감정보를 제외한 운영용 읽기 전용 요약입니다.</span>
      </div>
      <div className={styles.notice}>
        이메일, 소셜 식별자, 세션·토큰, IP/UA는 이 화면과 응답에 포함하지 않습니다.
      </div>
      <form className={styles.filters} onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={80}
          placeholder="닉네임, Handle 또는 Member UUID 검색"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as OpsMemberStatus | "")}
        >
          <option value="">모든 상태</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="LIMITED">LIMITED</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="DELETED">DELETED</option>
        </select>
        <button type="submit">검색</button>
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
              <th>사용자</th>
              <th>상태</th>
              <th>로그인 수단</th>
              <th>가입 / 최근 활동</th>
              <th>활동</th>
              <th>공개 프로필</th>
            </tr>
          </thead>
          <tbody>
            {items.map((member) => (
              <tr key={member.memberId}>
                <td>
                  <div className={styles.identity}>
                    <strong>{member.displayName}</strong>
                    <code>{member.memberId}</code>
                  </div>
                </td>
                <td>
                  <span className={styles.badge} data-status={member.status}>
                    {member.status}
                  </span>
                </td>
                <td>
                  {member.providers.length
                    ? member.providers.map((provider) => (
                        <span className={styles.provider} key={provider}>
                          {provider}
                        </span>
                      ))
                    : "없음"}
                </td>
                <td>
                  {dateTime(member.joinedAt)}
                  <br />
                  <small>최근 {dateTime(member.lastActiveAt)}</small>
                </td>
                <td>
                  투표 {member.activity.votes} · 댓글 {member.activity.comments} · 질문{" "}
                  {member.activity.issues}
                </td>
                <td>
                  {member.handle ? `@${member.handle}` : "미설정"}
                  <br />
                  <small>{member.profileVisibility ?? "-"}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && items.length === 0 ? (
        <div className={styles.empty}>조건에 맞는 사용자가 없습니다.</div>
      ) : null}
      {cursor ? (
        <button
          type="button"
          className={styles.more}
          disabled={loading}
          onClick={() => void load(true, cursor)}
        >
          {loading ? "불러오는 중" : "더 보기"}
        </button>
      ) : null}
    </section>
  );
}
