"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { toast } from "@/components/feedback/toast-provider";

import type { OpsTrustedImagePilotMember } from "./contracts";
import styles from "./ops-management.module.css";

type Action = "GRANT" | "SUSPEND" | "REVOKE" | "RESTORE";

export function OpsMediaUploadPilotPanel() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [items, setItems] = useState<OpsTrustedImagePilotMember[]>([]);
  const [rationale, setRationale] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (submittedQuery) params.set("query", submittedQuery);
      const response = await fetch(`/api/ops/media-upload-pilot?${params}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        items?: OpsTrustedImagePilotMember[];
        message?: string;
      };
      if (!response.ok) throw new Error(body.message || "Pilot 후보를 불러오지 못했습니다.");
      setItems(body.items ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot 후보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [submittedQuery]);

  useEffect(() => {
    // State updates happen after the operator request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function decide(memberId: string, action: Action) {
    if (rationale.trim().length < 10) {
      setError("판단 근거를 10자 이상 입력해 주세요.");
      return;
    }
    setBusyMemberId(memberId);
    setError("");
    try {
      const response = await fetch(
        `/api/ops/media-upload-pilot/${encodeURIComponent(memberId)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, rationale: rationale.trim() }),
        },
      );
      const body = (await response.json()) as {
        member?: OpsTrustedImagePilotMember;
        message?: string;
      };
      if (!response.ok || !body.member)
        throw new Error(body.message || "권한을 변경하지 못했습니다.");
      setItems((current) =>
        current.map((item) => (item.memberId === memberId ? body.member! : item)),
      );
      setRationale("");
      toast.success("이미지 업로드 Pilot 권한을 변경했어요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "권한을 변경하지 못했습니다.");
    } finally {
      setBusyMemberId(null);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  return (
    <section className={styles.page}>
      <div className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>TRUSTED IMAGE PILOT</p>
          <h1>이미지 업로드 권한</h1>
        </div>
        <span>기본 OFF · 30일 권한 · 모든 변경 이력 보존</span>
      </div>
      <div className={styles.notice}>
        자격 기준을 만족한 회원에게만 직접 업로드를 엽니다. 전체 Member 확대는 Pilot 증거 검토 후
        별도로 결정합니다.
      </div>
      <form className={styles.filters} onSubmit={search}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="닉네임, 이메일 또는 Member UUID"
          maxLength={160}
        />
        <input
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="권한 판단 근거 (10자 이상)"
          maxLength={2000}
        />
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
              <th>회원</th>
              <th>자격</th>
              <th>활동 / 위반</th>
              <th>동의</th>
              <th>현재 권한</th>
              <th>조치</th>
            </tr>
          </thead>
          <tbody>
            {items.map((member) => {
              const active = member.capability?.state === "ACTIVE";
              const revoked = member.capability?.state === "REVOKED";
              return (
                <tr key={member.memberId}>
                  <td>
                    <div className={styles.identity}>
                      <strong>{member.displayName}</strong>
                      <small>{member.email ?? "이메일 없음"}</small>
                      <code>{member.memberId}</code>
                    </div>
                  </td>
                  <td>{member.eligible ? "ELIGIBLE" : member.eligibilityReasons.join(" · ")}</td>
                  <td>
                    계정 {member.metrics.accountAgeDays}일 · 투표 {member.metrics.acceptedVotes} ·
                    질문 {member.metrics.publishedLowRiskIssues}
                    <br />
                    <small>90일 위반 {member.metrics.confirmedViolations90d}</small>
                  </td>
                  <td>{member.consentCurrent ? "CURRENT" : "MISSING"}</td>
                  <td>
                    {member.capability?.state ?? "NONE"}
                    {member.capability && !revoked ? (
                      <>
                        <br />
                        <small>
                          {new Date(member.capability.expiresAt).toLocaleDateString("ko-KR")}
                        </small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.provider}
                      disabled={busyMemberId === member.memberId || (!member.eligible && !active)}
                      onClick={() =>
                        void decide(
                          member.memberId,
                          active ? "SUSPEND" : member.capability ? "RESTORE" : "GRANT",
                        )
                      }
                    >
                      {active ? "일시중지" : member.capability ? "복원" : "권한 부여"}
                    </button>
                    {member.capability ? (
                      <button
                        type="button"
                        className={styles.provider}
                        disabled={busyMemberId === member.memberId}
                        onClick={() => void decide(member.memberId, "REVOKE")}
                      >
                        회수
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && items.length === 0 ? (
        <div className={styles.empty}>조건에 맞는 Pilot 후보가 없습니다.</div>
      ) : null}
    </section>
  );
}
