"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import type { InterestCardCode, InterestCardRegistry, InterestProfile } from "@/lib/contracts";
import { recordAnalyticsEvent } from "@/features/issues/client";

import {
  loadInterestCardRegistry,
  loadInterestProfile,
  mergeGuestInterestProfile,
  resetInterestProfile,
  saveInterestProfile,
} from "./client";
import styles from "./interest-selector.module.css";

type AnalyticsContext = { issueId: string; issueVersion: number };

export function InterestSelector({
  mode,
  analyticsContext,
}: {
  mode: "prompt" | "settings";
  analyticsContext?: AnalyticsContext;
}) {
  const [registry, setRegistry] = useState<InterestCardRegistry | null>(null);
  const [profile, setProfile] = useState<InterestProfile | null>(null);
  const [selected, setSelected] = useState<InterestCardCode[]>([]);
  const [mergeSelected, setMergeSelected] = useState<InterestCardCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRecorded = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([loadInterestCardRegistry(), loadInterestProfile()])
      .then(([loadedRegistry, loadedProfile]) => {
        if (!active) return;
        setRegistry(loadedRegistry);
        setProfile(loadedProfile);
        setSelected(loadedProfile.selectedCardCodes);
        setMergeSelected(loadedProfile.mergeCandidate?.suggestedCardCodes ?? []);
      })
      .catch(() => {
        if (active) setError("관심사 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const shouldShowPrompt = mode === "prompt" && profile?.onboardingState === "NOT_STARTED";
  useEffect(() => {
    if (!shouldShowPrompt || !analyticsContext || promptRecorded.current) return;
    promptRecorded.current = true;
    void recordAnalyticsEvent({
      eventType: "INTEREST_PROMPT_VIEW",
      ...analyticsContext,
    }).catch(() => undefined);
  }, [analyticsContext, shouldShowPrompt]);

  if (loading) {
    return mode === "settings" ? (
      <section className={styles.panel} aria-busy="true">
        관심 주제를 불러오는 중…
      </section>
    ) : null;
  }
  if (mode === "prompt" && !shouldShowPrompt) return null;
  if (!registry || !profile) {
    return mode === "settings" ? <section className={styles.panel}>{error}</section> : null;
  }

  const toggle = (code: InterestCardCode) => {
    setError(null);
    setSelected((current) => {
      if (current.includes(code)) return current.filter((item) => item !== code);
      if (current.length >= registry.maxSelections) {
        setError(`최대 ${registry.maxSelections}개까지 선택할 수 있어요.`);
        return current;
      }
      return [...current, code];
    });
  };

  const persist = async () => {
    if (selected.length < registry.minSelections) {
      setError(`${registry.minSelections - selected.length}개 더 골라주세요.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await saveInterestProfile({
        onboardingState: "COMPLETED",
        selectedCardCodes: selected,
      });
      setProfile(updated);
      setSelected(updated.selectedCardCodes);
      toast.success("관심 주제를 저장했어요.");
      if (analyticsContext) {
        void recordAnalyticsEvent({
          eventType: "INTEREST_SELECTION_COMPLETE",
          ...analyticsContext,
        }).catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "관심 주제를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const skip = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveInterestProfile({
        onboardingState: "SKIPPED",
        selectedCardCodes: [],
      });
      setProfile(updated);
      setSelected([]);
      toast.info("관심사는 나중에 설정할 수 있어요.");
      if (analyticsContext) {
        void recordAnalyticsEvent({
          eventType: "INTEREST_PROMPT_SKIP",
          ...analyticsContext,
        }).catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "나중에 하기를 처리하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await resetInterestProfile();
      setProfile(updated);
      setSelected([]);
      toast.success("추천 관심 신호를 초기화했어요. 투표와 댓글 기록은 그대로 유지됩니다.");
      if (analyticsContext) {
        void recordAnalyticsEvent({
          eventType: "INTEREST_PROFILE_RESET",
          ...analyticsContext,
        }).catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "추천 설정을 초기화하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const merge = async () => {
    if (!profile.mergeCandidate) return;
    if (selected.length + mergeSelected.length < registry.minSelections) {
      setError("병합 후 관심 주제가 3개 이상이어야 합니다.");
      return;
    }
    if (selected.length + mergeSelected.length > registry.maxSelections) {
      setError(`병합 후 관심 주제는 최대 ${registry.maxSelections}개까지 선택할 수 있어요.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await mergeGuestInterestProfile({
        anonymousSubjectId: profile.mergeCandidate.anonymousSubjectId,
        selectedCardCodes: mergeSelected,
      });
      setProfile(updated);
      setSelected(updated.selectedCardCodes);
      setMergeSelected([]);
      toast.success("확인한 Guest 관심 주제를 계정에 추가했어요.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Guest 관심사를 합치지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${styles.panel} ${mode === "prompt" ? styles.prompt : ""}`}>
      <p className={styles.eyebrow}>YOUR INTERESTS</p>
      <h2>{mode === "prompt" ? "다음 질문을 더 잘 골라드릴까요?" : "관심 주제 설정"}</h2>
      <p className={styles.description}>
        관심 있는 주제를 3개 이상 골라주세요. A와 B 중 무엇을 골랐는지는 관심 성향으로 저장하지
        않아요.
      </p>

      {profile.mergeCandidate ? (
        <div className={styles.mergeNotice}>
          <p>로그인 전 고른 관심 주제가 있어요. 자동으로 덮어쓰지 않고 확인 후 추가합니다.</p>
          <div className={styles.mergeCards} aria-label="병합할 Guest 관심사">
            {profile.mergeCandidate.suggestedCardCodes.map((code) => {
              const card = registry.cards.find((item) => item.code === code);
              const active = mergeSelected.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={active}
                  className={active ? styles.mergeActive : ""}
                  onClick={() =>
                    setMergeSelected((current) =>
                      current.includes(code)
                        ? current.filter((item) => item !== code)
                        : [...current, code],
                    )
                  }
                >
                  {card?.label ?? code}
                </button>
              );
            })}
          </div>
          <button type="button" disabled={saving} onClick={() => void merge()}>
            선택한 Guest 관심사 추가
          </button>
        </div>
      ) : null}

      <div className={styles.grid} aria-label="관심 주제">
        {registry.cards.map((card) => {
          const active = selected.includes(card.code);
          return (
            <button
              key={card.code}
              type="button"
              className={active ? styles.active : ""}
              aria-pressed={active}
              disabled={saving}
              onClick={() => toggle(card.code)}
            >
              {card.label}
            </button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <span>
          {selected.length}/{registry.maxSelections} 선택
        </span>
        <div>
          {mode === "prompt" && profile.canSkip ? (
            <button
              className={styles.secondary}
              type="button"
              disabled={saving}
              onClick={() => void skip()}
            >
              나중에
            </button>
          ) : null}
          {mode === "settings" && profile.onboardingState !== "NOT_STARTED" ? (
            <button
              className={styles.secondary}
              type="button"
              disabled={saving}
              onClick={() => void reset()}
            >
              추천 재설정
            </button>
          ) : null}
          <button
            className={styles.primary}
            type="button"
            disabled={saving || selected.length < registry.minSelections}
            onClick={() => void persist()}
          >
            {saving ? "저장 중…" : "선택 저장"}
          </button>
        </div>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {mode === "prompt" && profile.onboardingState === "COMPLETED" ? (
        <p className={styles.manage}>
          <Link href="/interests">관심사 관리하기</Link>
        </p>
      ) : null}
    </section>
  );
}
