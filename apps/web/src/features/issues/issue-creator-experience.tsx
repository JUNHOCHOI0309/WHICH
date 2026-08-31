"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type {
  CreateIssueCommand,
  InterestCardRegistry,
  IssueMediaUploadAccess,
  IssueMediaLibraryPair,
} from "@/lib/contracts";

import {
  acceptIssueMediaConsent,
  attachIssueSubmissionMedia,
  createMemberIssue,
  loadIssueCreationContext,
  loadIssueMediaLibrary,
  submitMemberIssue,
  uploadIssueSubmissionMedia,
} from "./issue-creator-client";
import styles from "./issue-creator-experience.module.css";
import { trackSubmission } from "./submission-feedback";

const DRAFT_KEY = "which_issue_draft_v1";
const EMPTY_DRAFT: CreateIssueCommand = {
  question: "",
  context: "",
  choiceA: "",
  choiceB: "",
  interestCardCode: "DAILY_LIFE",
};

function initialDraft() {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  const saved = window.sessionStorage.getItem(DRAFT_KEY);
  if (!saved) return EMPTY_DRAFT;
  try {
    return { ...EMPTY_DRAFT, ...(JSON.parse(saved) as Partial<CreateIssueCommand>) };
  } catch {
    window.sessionStorage.removeItem(DRAFT_KEY);
    return EMPTY_DRAFT;
  }
}

function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

export function IssueCreatorExperience({
  presentation = "page",
  onSubmitted,
}: {
  presentation?: "page" | "modal";
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "guest" | "member" | "error">("loading");
  const [registry, setRegistry] = useState<InterestCardRegistry | null>(null);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const [mediaAccess, setMediaAccess] = useState<IssueMediaUploadAccess | null>(null);
  const [libraryState, setLibraryState] = useState<"loading" | "ready" | "error">("loading");
  const [mediaMode, setMediaMode] = useState<"TEXT_ONLY" | "LIBRARY" | "DIRECT">(
    initialDraft().libraryPairId ? "LIBRARY" : "TEXT_ONLY",
  );
  const [draft, setDraft] = useState<CreateIssueCommand>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [acceptingMediaTerms, setAcceptingMediaTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directFiles, setDirectFiles] = useState<{ A: File | null; B: File | null }>({
    A: null,
    B: null,
  });
  const directPreviewA = useObjectUrl(directFiles.A);
  const directPreviewB = useObjectUrl(directFiles.B);
  const pendingKey = useRef<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    void loadIssueCreationContext()
      .then(async (context) => {
        if (!context.authenticated) {
          setState("guest");
          return;
        }
        setMediaAccess(context.mediaAccess);
        const libraryResult = await loadIssueMediaLibrary().catch(() => null);
        if (libraryResult) {
          setLibrary(libraryResult.items);
          setLibraryState("ready");
        } else {
          setLibraryState("error");
        }
        setRegistry(context.registry);
        setState("member");
      })
      .catch(() => setState("error"));
  }, []);

  const update = <K extends keyof CreateIssueCommand>(key: K, value: CreateIssueCommand[K]) => {
    setError(null);
    setDraft((current) => {
      const next = { ...current, [key]: value };
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
    pendingKey.current = null;
  };

  if (state === "loading") {
    return <section className={styles.panel}>질문 작성 환경을 준비하는 중…</section>;
  }

  if (state === "guest") {
    return (
      <section className={`${styles.panel} ${styles.guestPanel}`}>
        <p className={styles.eyebrow}>MEMBER CREATION</p>
        <h1>질문은 Member가 만들 수 있어요.</h1>
        <p>
          작성 중인 내용은 이 브라우저에 잠시 보관됩니다. 로그인하거나 빠르게 가입한 뒤 그대로
          이어서 작성하세요.
        </p>
        <Link
          className={styles.primaryLink}
          href={
            presentation === "modal"
              ? "/login?returnTo=%2F%3Fcompose%3Dquestion"
              : "/login?returnTo=%2Fcreate"
          }
        >
          로그인하고 질문 만들기 <span aria-hidden="true">→</span>
        </Link>
      </section>
    );
  }

  if (state === "error" || !registry) {
    return (
      <section className={styles.panel}>
        질문 작성 환경을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </section>
    );
  }

  const selectedLabel =
    registry.cards.find((card) => card.code === draft.interestCardCode)?.label ?? "생활";
  const selectedPair = library.find((pair) => pair.id === draft.libraryPairId) ?? null;

  return (
    <form
      className={`${styles.form} ${presentation === "modal" ? styles.modalForm : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError(null);
        pendingKey.current ??= crypto.randomUUID();
        const publish = async () => {
          if (mediaMode !== "DIRECT") {
            const result = await createMemberIssue(draft, pendingKey.current!);
            return { kind: "PUBLISHED" as const, issueId: result.issue.id };
          }
          if (!mediaAccess?.allowed || !directFiles.A || !directFiles.B) {
            throw new Error("A와 B 이미지를 모두 선택해 주세요.");
          }
          const base = { ...draft, libraryPairId: null, mediaAssetAId: null, mediaAssetBId: null };
          const result = await submitMemberIssue(base, pendingKey.current!);
          const assetA = await uploadIssueSubmissionMedia(result.submission.id, directFiles.A);
          const assetB = await uploadIssueSubmissionMedia(result.submission.id, directFiles.B);
          const attached = await attachIssueSubmissionMedia(
            result.submission,
            base,
            assetA.asset.id,
            assetB.asset.id,
            crypto.randomUUID(),
          );
          return { kind: "PENDING" as const, submission: attached.submission };
        };
        void publish()
          .then((result) => {
            window.sessionStorage.removeItem(DRAFT_KEY);
            pendingKey.current = null;
            onSubmitted?.();
            if (result.kind === "PUBLISHED") {
              toast.success("질문을 게시했어요.");
              if (presentation === "page") router.push(`/issues/${result.issueId}`);
            } else {
              trackSubmission(result.submission);
              toast.info("질문을 접수했어요. 안전 검사를 거쳐 게시 결과를 알려드릴게요.");
              if (presentation === "page") router.push("/me/submissions");
            }
          })
          .catch((reason) => {
            const status =
              typeof reason === "object" && reason !== null && "status" in reason
                ? Number(reason.status)
                : 0;
            if (status === 401) setState("guest");
            const message = reason instanceof Error ? reason.message : "질문을 만들지 못했습니다.";
            setError(message);
            toast.error(message);
          })
          .finally(() => {
            submittingRef.current = false;
            setSubmitting(false);
          });
      }}
    >
      <section className={styles.panel}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>CREATE YOUR CHOICE</p>
            <h1>사람들에게 어떤 선택을 물어볼까요?</h1>
          </div>
        </div>

        <label className={styles.field}>
          <span>질문</span>
          <input
            value={draft.question}
            onChange={(event) => update("question", event.target.value)}
            maxLength={120}
            placeholder="예: 퇴근 후 바로 잘까, 조금 더 놀까?"
            required
          />
          <small>
            {Array.from(draft.question).length}/120 · 물음표는 빠져 있어도 자동으로 붙여드려요.
          </small>
        </label>

        <label className={styles.field}>
          <span>
            짧은 설명 <em>선택</em>
          </span>
          <textarea
            value={draft.context ?? ""}
            onChange={(event) => update("context", event.target.value)}
            maxLength={240}
            placeholder="선택할 때 생각해 볼 상황을 한 줄로 덧붙여 보세요."
          />
          <small>{Array.from(draft.context ?? "").length}/240</small>
        </label>

        <div className={styles.choiceGrid}>
          <label className={styles.choiceField} data-side="A">
            <span>
              <b>A</b> 첫 번째 선택
            </span>
            <input
              value={draft.choiceA}
              onChange={(event) => update("choiceA", event.target.value)}
              maxLength={50}
              placeholder="바로 자기"
              required
            />
          </label>
          <label className={styles.choiceField} data-side="B">
            <span>
              <b>B</b> 두 번째 선택
            </span>
            <input
              value={draft.choiceB}
              onChange={(event) => update("choiceB", event.target.value)}
              maxLength={50}
              placeholder="조금 더 놀기"
              required
            />
          </label>
        </div>

        <fieldset className={styles.mediaPicker}>
          <legend>이미지 방식</legend>
          <div className={styles.mediaModes}>
            <button
              type="button"
              data-active={mediaMode === "TEXT_ONLY"}
              onClick={() => {
                setMediaMode("TEXT_ONLY");
                update("libraryPairId", null);
                setDirectFiles({ A: null, B: null });
              }}
            >
              텍스트만
            </button>
            <button
              type="button"
              data-active={mediaMode === "LIBRARY"}
              onClick={() => setMediaMode("LIBRARY")}
            >
              승인 이미지 Library
            </button>
            <button
              type="button"
              data-active={mediaMode === "DIRECT"}
              disabled={!mediaAccess?.allowed}
              title={
                mediaAccess?.allowed
                  ? "선택지 이미지를 직접 올립니다."
                  : "신뢰 사용자 Pilot 대상에게 순차 제공됩니다."
              }
              onClick={() => {
                setMediaMode("DIRECT");
                update("libraryPairId", null);
              }}
            >
              {mediaAccess?.allowed ? "직접 업로드" : "직접 업로드 · Pilot"}
            </button>
          </div>
          {mediaAccess?.mode === "PILOT" && mediaAccess.reasons.includes("CONSENT_REQUIRED") ? (
            <div className={styles.mediaConsent}>
              <p>
                이미지 직접 업로드 전에 현재 <Link href="/legal/terms">이용약관</Link>과{" "}
                <Link href="/legal/privacy">개인정보 처리방침</Link>의 콘텐츠 권리·자동 안전 검사·
                OpenAI 국외 처리 및 보존 조건을 한 번 확인해 주세요. 동의하지 않아도 텍스트 질문은
                작성할 수 있습니다.
              </p>
              <button
                type="button"
                disabled={acceptingMediaTerms}
                onClick={() => {
                  setAcceptingMediaTerms(true);
                  void acceptIssueMediaConsent()
                    .then(({ access }) => {
                      setMediaAccess(access);
                      toast.success("이미지 업로드 약관에 동의했어요.");
                    })
                    .catch((reason) =>
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : "이미지 업로드 약관 동의를 저장하지 못했습니다.",
                      ),
                    )
                    .finally(() => setAcceptingMediaTerms(false));
                }}
              >
                {acceptingMediaTerms ? "저장 중…" : "확인하고 동의"}
              </button>
            </div>
          ) : null}
          {mediaMode === "LIBRARY" ? (
            <div className={styles.libraryPanel}>
              <p>
                출처와 사용 권리가 검증된 A/B 이미지 쌍입니다. 선택하면 추가 검수 없이 바로
                게시돼요.
              </p>
              {libraryState === "loading" ? <span>Library를 불러오는 중…</span> : null}
              {libraryState === "error" ? <span>Library를 잠시 불러오지 못했습니다.</span> : null}
              {libraryState === "ready" && library.length === 0 ? (
                <span>현재 사용할 수 있는 이미지 쌍이 없습니다.</span>
              ) : null}
              <div className={styles.libraryGrid}>
                {library.map((pair) => (
                  <button
                    type="button"
                    key={pair.id}
                    data-selected={draft.libraryPairId === pair.id}
                    onClick={() => update("libraryPairId", pair.id)}
                  >
                    <span className={styles.libraryImages}>
                      {pair.assets.map((asset) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={asset.id} src={asset.url} alt={asset.altText} />
                      ))}
                    </span>
                    <b>{pair.title}</b>
                    <small>{pair.topics.slice(0, 3).join(" · ") || pair.categoryCode}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {mediaMode === "DIRECT" && mediaAccess?.allowed ? (
            <div className={styles.directUploadPanel}>
              <p>
                JPG, PNG, WebP 이미지를 A/B 각각 선택하세요. 등록 즉시 비공개 안전 검사를 거치며,
                통과한 질문만 공개됩니다.
              </p>
              <div>
                {(["A", "B"] as const).map((side) => (
                  <label key={side} data-side={side}>
                    <b>{side}</b>
                    <span>{directFiles[side]?.name ?? `${side} 선택 이미지`}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) =>
                        setDirectFiles((current) => ({
                          ...current,
                          [side]: event.target.files?.[0] ?? null,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset className={styles.categories}>
          <legend>관심 주제</legend>
          <div>
            {registry.cards.map((card) => (
              <label key={card.code}>
                <input
                  type="radio"
                  name="interest-card"
                  checked={draft.interestCardCode === card.code}
                  onChange={() => update("interestCardCode", card.code)}
                />
                <span>{card.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={`${styles.panel} ${styles.preview}`} aria-label="질문 미리보기">
        <div className={styles.previewMeta}>
          <span>PREVIEW</span>
          <b>{selectedLabel}</b>
        </div>
        <h2>{draft.question.trim() || "질문이 여기에 표시됩니다."}</h2>
        {draft.context?.trim() ? <p>{draft.context}</p> : null}
        <div className={styles.previewChoice} data-side="A">
          {selectedPair?.assets.find((asset) => asset.side === "A") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedPair.assets.find((asset) => asset.side === "A")!.url}
              alt={selectedPair.assets.find((asset) => asset.side === "A")!.altText}
            />
          ) : directPreviewA ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={directPreviewA} alt="A 선택 이미지 미리보기" />
          ) : null}
          <b>A</b>
          <span>{draft.choiceA || "첫 번째 선택"}</span>
        </div>
        <div className={styles.previewChoice} data-side="B">
          {selectedPair?.assets.find((asset) => asset.side === "B") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedPair.assets.find((asset) => asset.side === "B")!.url}
              alt={selectedPair.assets.find((asset) => asset.side === "B")!.altText}
            />
          ) : directPreviewB ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={directPreviewB} alt="B 선택 이미지 미리보기" />
          ) : null}
          <b>B</b>
          <span>{draft.choiceB || "두 번째 선택"}</span>
        </div>
      </section>

      <div className={styles.submitBar}>
        <p>
          {mediaMode === "DIRECT"
            ? "선택한 이미지는 비공개 안전 검사를 거친 뒤 공개됩니다."
            : selectedPair
              ? "승인 Library 이미지와 함께 바로 피드에 표시됩니다."
              : "공개 후 바로 피드에 표시됩니다."}{" "}
          링크·정치·고위험 주제는 v1에서 게시할 수 없어요.
        </p>
        <button
          type="submit"
          disabled={
            submitting ||
            (mediaMode === "LIBRARY" && !draft.libraryPairId) ||
            (mediaMode === "DIRECT" && (!directFiles.A || !directFiles.B))
          }
        >
          {submitting ? "게시 요청 중…" : "질문 게시"}
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
