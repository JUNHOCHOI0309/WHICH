"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./ops-poll-candidates.module.css";

type Poll = {
  id: string;
  status: "NEW" | "REVIEW" | "DISMISSED";
  editorialCandidateId: string | null;
  source: {
    channel: string;
    originalQuestion: string;
    originalChoices: string[];
    sourceUrl: string;
    participationText?: string | null;
    observedDate?: string | null;
  };
};
type Page = {
  items: Poll[];
  nextCursor: string | null;
  channels: string[];
  channelRegister?: Array<{
    name: string;
    channelUrl: string;
    identityNeedsConfirmation: boolean;
  }>;
  octoparseConfigured: boolean;
};
const labels = { NEW: "대기", REVIEW: "검수함 전송 완료", DISMISSED: "제외" };
const interests = [
  ["DAILY_LIFE", "일상"],
  ["FOOD", "음식"],
  ["TRAVEL", "여행"],
  ["RELATIONSHIP", "관계"],
  ["WORK", "직장"],
  ["ECONOMY_CONSUMPTION", "경제·소비"],
  ["TECH", "테크"],
  ["GAME", "게임"],
  ["MOVIE_DRAMA", "영화·드라마"],
  ["MUSIC_CONTENT", "음악·콘텐츠"],
  ["SPORTS", "스포츠"],
  ["EDUCATION", "교육"],
  ["SOCIETY", "사회"],
  ["HOBBY", "취미"],
];

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/ops/poll-candidates${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "투표 후보를 처리하지 못했습니다.");
  return data;
}

export function OpsPollCandidatesPanel() {
  const [page, setPage] = useState<Page | null>(null);
  const [filter, setFilter] = useState("NEW");
  const [channel, setChannel] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [json, setJson] = useState("");
  const [selected, setSelected] = useState<Poll | null>(null);
  const [draft, setDraft] = useState({
    question: "",
    context: "정답은 없습니다. 지금의 생각과 가까운 쪽을 골라 주세요.",
    choices: [] as string[],
    interestCardCode: "DAILY_LIFE",
  });
  const load = useCallback(async () => {
    const data = await api("");
    setPage(data);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void api("").then(
      (data: Page) => {
        if (!cancelled) setPage(data);
      },
      (error: Error) => {
        if (!cancelled) setMessage(error.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  function choose(poll: Poll) {
    setSelected(poll);
    setDraft({
      question: poll.source.originalQuestion,
      context: "정답은 없습니다. 지금의 생각과 가까운 쪽을 골라 주세요.",
      choices: [...poll.source.originalChoices],
      interestCardCode: "DAILY_LIFE",
    });
  }
  async function importJson() {
    const parsed = JSON.parse(json);
    const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed.candidates);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500)
      throw new Error("후보 배열 또는 candidates/rows 배열이 있는 JSON을 입력해 주세요.");
    const result = {
      imported: 0,
      updated: 0,
      errors: [] as Array<{ row: number; message: string }>,
    };
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = await api("/import", "POST", { rows: rows.slice(offset, offset + 200) });
      result.imported += batch.imported;
      result.updated += batch.updated;
      result.errors.push(
        ...batch.errors.map((item: { row: number; message: string }) => ({
          ...item,
          row: item.row + offset,
        })),
      );
    }
    await load();
    if (!result.errors.length) setJson("");
    setMessage(
      `신규 ${result.imported}개 · 기존 갱신 ${result.updated}개 · 제외 ${result.errors.length}개${result.errors.length ? " — " + result.errors.map((item: { row: number; message: string }) => `${item.row}행: ${item.message}`).join(" / ") : ""}`,
    );
  }
  const items =
    page?.items.filter(
      (poll) =>
        (!filter || poll.status === filter) &&
        (!channel || poll.source.channel === channel) &&
        (!query ||
          `${poll.source.originalQuestion} ${poll.source.originalChoices.join(" ")}`.includes(
            query,
          )),
    ) ?? [];
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p>POLL CANDIDATES</p>
        <h1>투표 후보</h1>
        <span>원문을 확인하고 텍스트 질문을 Review Center로 보내세요.</span>
      </header>
      <section className={styles.connection} aria-label="Octoparse 연결 상태">
        <strong>Octoparse · 연결 정보 대기</strong>
        <p>
          채널 주소 준비 완료 · 실제 작업 ID, 서버 인증 정보와 수집 샘플은 아직 대기 중입니다.
          현재는 아래 입력 형식으로 정리한 JSON을 가져올 수 있습니다. 자동 수집은 실행하지 않습니다.
        </p>
        <details>
          <summary>수집 대상 채널 {page?.channels.length ?? 12}개</summary>
          <p>{page?.channels.join(" · ")}</p>
          <ul>
            {page?.channelRegister?.map((item) => (
              <li key={item.name}>
                <a href={item.channelUrl} target="_blank" rel="noreferrer">
                  {item.name} ↗
                </a>
                {item.identityNeedsConfirmation
                  ? " · 동명 채널 확인 필요 / 초기 자동 수집 보류"
                  : " · 실제 수집 미검증"}
              </li>
            ))}
          </ul>
        </details>
      </section>
      <details className={styles.import}>
        <summary>수집 결과 JSON 가져오기</summary>
        <p>
          아래 형식으로 변환한 수집 결과 또는 기존 스튜디오의 후보 JSON을 입력하세요. 원문 질문과
          전체 선택지를 보관합니다.
        </p>
        <details>
          <summary>입력 형식</summary>
          <pre>
            {JSON.stringify(
              [
                {
                  channel: "진행빵집",
                  sourceUrl: "https://www.youtube.com/post/실제게시물ID",
                  originalQuestion: "질문",
                  originalChoices: ["선택지 A", "선택지 B"],
                  participationText: "1.2만명 투표",
                  observedDate: "2026-09-19",
                },
              ],
              null,
              2,
            )}
          </pre>
        </details>
        <label>
          후보 JSON
          <textarea value={json} onChange={(event) => setJson(event.target.value)} />
        </label>
        <button disabled={busy || !json.trim()} onClick={() => void run(importJson)}>
          투표 후보로 가져오기
        </button>
      </details>
      <div className={styles.filters}>
        <label>
          상태
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">전체</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          채널
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="">전체 채널</option>
            {page?.channels.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          질문 검색
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button disabled={busy} onClick={() => void run(load)}>
          새로고침
        </button>
      </div>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      <div className={styles.workspace}>
        <div className={styles.list} aria-label="투표 후보 목록">
          {items.map((poll) => (
            <button
              className={styles.card}
              key={poll.id}
              aria-pressed={selected?.id === poll.id}
              disabled={busy}
              onClick={() => choose(poll)}
            >
              <small>
                {poll.source.channel} · {labels[poll.status]}
              </small>
              <strong>{poll.source.originalQuestion}</strong>
              <span>
                {poll.source.originalChoices.length}개 선택지 ·{" "}
                {poll.source.participationText || "참여 규모 미상"}
              </span>
            </button>
          ))}
          {!items.length && (
            <p>{page ? "조건에 맞는 투표 후보가 없습니다." : "투표 후보를 불러오고 있습니다."}</p>
          )}
          {page?.nextCursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next: Page = await api(`?before=${page.nextCursor}`);
                  setPage({ ...next, items: [...page.items, ...next.items] });
                })
              }
            >
              후보 더 보기
            </button>
          )}
        </div>
        <div className={styles.editor}>
          {selected ? (
            <>
              <small>
                {selected.source.channel} · {selected.source.observedDate || "게시일 미상"}
              </small>
              <h2>{selected.source.originalQuestion}</h2>
              <ol>
                {selected.source.originalChoices.map((choice, index) => (
                  <li key={index}>{choice}</li>
                ))}
              </ol>
              <a href={selected.source.sourceUrl} target="_blank" rel="noreferrer">
                YouTube 원문 보기 ↗
              </a>
              <p>
                외부 참여 규모: {selected.source.participationText || "미상"} · WHICH 참여 수에는
                포함되지 않습니다.
              </p>
              {selected.editorialCandidateId ? (
                <a
                  className={styles.reviewLink}
                  href={`/ops?tab=review&candidate=${encodeURIComponent(selected.editorialCandidateId)}`}
                >
                  Review Center에서 검수 후보 보기 →
                </a>
              ) : selected.status === "DISMISSED" ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await api(`/${selected.id}`, "PATCH", { status: "NEW" });
                      setSelected(next);
                      await load();
                    })
                  }
                >
                  후보 복원
                </button>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const result = await api(`/${selected.id}/review`, "POST", draft);
                      setSelected({
                        ...selected,
                        status: "REVIEW",
                        editorialCandidateId: result.candidateId,
                      });
                      await load();
                      setMessage(
                        result.replayed
                          ? "이미 등록된 검수 후보를 연결했습니다."
                          : "텍스트 질문을 검수 후보로 보냈습니다.",
                      );
                    });
                  }}
                >
                  <h3>검수함에 보낼 텍스트</h3>
                  <label>
                    질문
                    <input
                      required
                      maxLength={200}
                      value={draft.question}
                      onChange={(event) => setDraft({ ...draft, question: event.target.value })}
                    />
                  </label>
                  <label>
                    설명
                    <textarea
                      required
                      maxLength={500}
                      value={draft.context}
                      onChange={(event) => setDraft({ ...draft, context: event.target.value })}
                    />
                  </label>
                  <label>
                    관심 주제
                    <select
                      value={draft.interestCardCode}
                      onChange={(event) =>
                        setDraft({ ...draft, interestCardCode: event.target.value })
                      }
                    >
                      {interests.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.choices.map((choice, index) => (
                    <div className={styles.choice} key={index}>
                      <label>
                        선택지 {String.fromCharCode(65 + index)}
                        <input
                          required
                          maxLength={100}
                          value={choice}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              choices: draft.choices.map((old, i) =>
                                i === index ? event.target.value : old,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || draft.choices.length <= 2}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            choices: draft.choices.filter((_, i) => i !== index),
                          })
                        }
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                  {draft.choices.length > 4 && (
                    <p role="alert">
                      원문은 모두 보관됩니다. WHICH용 선택지를 2~4개로 편집해 주세요.
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy || draft.choices.length >= 4}
                    onClick={() => setDraft({ ...draft, choices: [...draft.choices, ""] })}
                  >
                    선택지 추가
                  </button>
                  <p>
                    이미지 없이 검수 대기로 등록됩니다. 이미지는 Review Center에서 추가할 수
                    있습니다.
                  </p>
                  <div className={styles.actions}>
                    <button disabled={busy || draft.choices.length > 4}>검수 후보로 보내기</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const next = await api(`/${selected.id}`, "PATCH", {
                            status: "DISMISSED",
                          });
                          setSelected(next);
                          await load();
                        })
                      }
                    >
                      후보 제외
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <p>목록에서 투표 후보를 선택하세요.</p>
          )}
        </div>
      </div>
    </section>
  );
}
