"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/feedback/toast-provider";
import { WhichShell } from "@/components/layout/which-shell";
import type { IssueMediaLibraryPair, MemberIssueSubmission } from "@/lib/contracts";
import {
  actOnMemberSubmission,
  loadIssueMediaLibrary,
  loadMemberSubmissions,
  updateMemberSubmission,
  uploadIssueSubmissionMedia,
} from "./issue-creator-client";
import styles from "./member-submissions-experience.module.css";

const labels = {
  PROCESSING: "처리 중",
  PUBLISHED: "게시 완료",
  NEEDS_CHANGES: "수정 필요",
  REJECTED: "게시 불가",
  QUARANTINED: "공개 보류",
  CANCELLED: "취소됨",
};

export function MemberSubmissionsExperience({
  creationEnabled = false,
}: {
  creationEnabled?: boolean;
}) {
  const [items, setItems] = useState<MemberIssueSubmission[]>([]);
  const [screen, setScreen] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editing, setEditing] = useState<MemberIssueSubmission | null>(null);
  const [files, setFiles] = useState<{ a: File | null; b: File | null }>({ a: null, b: null });
  const [libraryTarget, setLibraryTarget] = useState<MemberIssueSubmission | null>(null);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const key = useRef("");

  async function load() {
    try {
      setItems((await loadMemberSubmissions()).items);
      setScreen("ready");
    } catch (error) {
      setScreen((error as { status?: number }).status === 401 ? "guest" : "error");
    }
  }
  useEffect(() => {
    let active = true;
    void loadMemberSubmissions()
      .then((result) => {
        if (active) {
          setItems(result.items);
          setScreen("ready");
        }
      })
      .catch((error) => {
        if (active) setScreen(error.status === 401 ? "guest" : "error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "처리하지 못했어요.");
      await load();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function replace(item: MemberIssueSubmission) {
    setItems((current) => current.map((row) => (row.id === item.id ? item : row)));
    setEditing(null);
    setLibraryTarget(null);
    setFiles({ a: null, b: null });
  }
  async function action(
    item: MemberIssueSubmission,
    kind: "TEXT_ONLY" | "LIBRARY" | "CANCEL" | "CHECK",
    pairId?: string,
  ) {
    await run(async () => {
      const result = await actOnMemberSubmission(item, kind, pairId);
      replace(result.submission);
      toast.success(
        kind === "CANCEL"
          ? "제출을 취소했어요."
          : result.submission.publishedIssueId
            ? "질문이 게시되었어요."
            : "최신 상태를 확인했어요.",
      );
    });
  }
  async function save() {
    if (!editing) return;
    if (Boolean(files.a) !== Boolean(files.b))
      return toast.error("새 이미지는 A와 B를 함께 선택해 주세요.");
    await run(async () => {
      let mediaAssetAId = editing.mediaAssetAId;
      let mediaAssetBId = editing.mediaAssetBId;
      if (files.a && files.b) {
        // Sequential uploads preserve the server upload-session quota and failure handling.
        mediaAssetAId = (await uploadIssueSubmissionMedia(editing.id, files.a)).asset.id;
        mediaAssetBId = (await uploadIssueSubmissionMedia(editing.id, files.b)).asset.id;
      }
      const result = await updateMemberSubmission(
        editing,
        {
          question: editing.question,
          context: editing.context || null,
          choiceA: editing.choiceA,
          choiceB: editing.choiceB,
          interestCardCode: editing.interestCardCode,
          mediaAssetAId,
          mediaAssetBId,
        },
        key.current,
      );
      replace(result.submission);
      toast.success("수정한 질문을 제출했어요.");
    });
  }

  return (
    <WhichShell active="me" creationEnabled={creationEnabled}>
      <main className={styles.page}>
        <header className={styles.heading}>
          <div>
            <p>MY QUESTIONS</p>
            <h1>내 질문</h1>
          </div>
          <button disabled={busy} onClick={() => void run(load)}>
            새로고침
          </button>
        </header>
        <nav className={styles.nav} aria-label="내 기록 메뉴">
          <Link href="/me">프로필</Link>
          <Link href="/me/votes">투표 기록</Link>
          <Link href="/me/submissions" aria-current="page">
            내 질문
          </Link>
        </nav>
        <p className={styles.note}>
          최근 제출한 질문 20개입니다. 이미지를 검사하는 동안에도 수정하거나 이미지 없이 게시할 수
          있어요.
        </p>
        {screen === "loading" ? <p role="status">질문을 불러오고 있어요.</p> : null}
        {screen === "guest" ? (
          <Link href="/login?returnTo=%2Fme%2Fsubmissions">로그인하고 내 질문 보기</Link>
        ) : null}
        {screen === "error" ? (
          <p role="alert">질문을 불러오지 못했어요. 새로고침으로 다시 시도해 주세요.</p>
        ) : null}
        {screen === "ready" && !items.length ? (
          <section className={styles.card}>아직 제출한 질문이 없어요.</section>
        ) : null}
        {screen === "ready"
          ? items.map((item) => {
              const editable =
                !item.publishedIssueId && ["PENDING", "NEEDS_CHANGES"].includes(item.status);
              const state =
                item.publicationState ??
                (item.status === "PENDING" || item.status === "APPROVED"
                  ? "PROCESSING"
                  : item.status);
              return (
                <article className={styles.card} key={item.id} aria-label={item.question}>
                  <div className={styles.heading}>
                    <strong className={styles.badge}>{labels[state]}</strong>
                    <small>수정본 {item.revision}</small>
                  </div>
                  <h2>{item.question}</h2>
                  <p>{item.context}</p>
                  <div className={styles.choices}>
                    <span>A · {item.choiceA}</span>
                    <span>B · {item.choiceB}</span>
                  </div>
                  {item.reviewNote ? <p className={styles.note}>{item.reviewNote}</p> : null}
                  {item.publishedIssueId ? (
                    <Link className={styles.link} href={`/issues/${item.publishedIssueId}`}>
                      게시된 질문 보기 →
                    </Link>
                  ) : null}
                  {editable ? (
                    <div className={styles.actions}>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing({ ...item });
                          setLibraryTarget(null);
                          setFiles({ a: null, b: null });
                          key.current = crypto.randomUUID();
                        }}
                      >
                        수정·이미지 변경
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("이미지를 제외하고 이 질문을 바로 게시할까요?"))
                            void action(item, "TEXT_ONLY");
                        }}
                      >
                        이미지 없이 게시
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await loadIssueMediaLibrary();
                            setLibrary(result.items);
                            setLibraryTarget(item);
                            setEditing(null);
                          })
                        }
                      >
                        Library로 교체
                      </button>
                      <button disabled={busy} onClick={() => void action(item, "CHECK")}>
                        게시 상태 확인
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "이 질문 제출을 취소할까요? 취소한 제출은 다시 게시되지 않아요.",
                            )
                          )
                            void action(item, "CANCEL");
                        }}
                      >
                        제출 취소
                      </button>
                    </div>
                  ) : null}
                  {editing?.id === item.id ? (
                    <form
                      className={styles.form}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save();
                      }}
                    >
                      <label>
                        질문
                        <input
                          required
                          minLength={5}
                          maxLength={120}
                          value={editing.question}
                          onChange={(event) => {
                            setEditing({ ...editing, question: event.target.value });
                            key.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <label>
                        짧은 설명
                        <textarea
                          maxLength={240}
                          value={editing.context ?? ""}
                          onChange={(event) => {
                            setEditing({ ...editing, context: event.target.value });
                            key.current = crypto.randomUUID();
                          }}
                        />
                      </label>
                      <div className={styles.choices}>
                        {(["A", "B"] as const).map((side) => (
                          <label key={side}>
                            {side} 선택지
                            <input
                              required
                              maxLength={50}
                              value={side === "A" ? editing.choiceA : editing.choiceB}
                              onChange={(event) => {
                                setEditing({
                                  ...editing,
                                  [side === "A" ? "choiceA" : "choiceB"]: event.target.value,
                                });
                                key.current = crypto.randomUUID();
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <p className={styles.note}>
                        이미지를 바꾸지 않으면 기존 이미지를 유지합니다. 새 이미지는 업로드 권한과
                        안전 검사가 필요해요.
                      </p>
                      <div className={styles.choices}>
                        {(["a", "b"] as const).map((side) => (
                          <label key={side}>
                            {side.toUpperCase()} 새 이미지
                            <input
                              disabled={busy}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => {
                                setFiles((current) => ({
                                  ...current,
                                  [side]: event.target.files?.[0] ?? null,
                                }));
                                key.current = crypto.randomUUID();
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <div className={styles.actions}>
                        <button className={styles.primary} disabled={busy} type="submit">
                          수정본 제출
                        </button>
                        <button disabled={busy} type="button" onClick={() => setEditing(null)}>
                          접기
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {libraryTarget?.id === item.id ? (
                    <section className={styles.library} aria-label="승인된 이미지 선택">
                      {!library.length ? (
                        <p>지금 사용할 수 있는 Library 이미지가 없어요.</p>
                      ) : (
                        library.map((pair) => (
                          <button
                            disabled={busy}
                            key={pair.id}
                            onClick={() => {
                              if (window.confirm("선택한 Library 이미지로 바로 게시할까요?"))
                                void action(item, "LIBRARY", pair.id);
                            }}
                          >
                            <strong>{pair.title}</strong>
                            <div className={styles.choices}>
                              {pair.assets.map((asset) => (
                                <figure key={asset.id}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={asset.url} alt={asset.altText} />
                                  <figcaption>
                                    {asset.side} · {asset.altText}
                                    {asset.attributionText ? ` · ${asset.attributionText}` : ""}
                                  </figcaption>
                                </figure>
                              ))}
                            </div>
                          </button>
                        ))
                      )}
                      <button disabled={busy} onClick={() => setLibraryTarget(null)}>
                        접기
                      </button>
                    </section>
                  ) : null}
                </article>
              );
            })
          : null}
      </main>
    </WhichShell>
  );
}
