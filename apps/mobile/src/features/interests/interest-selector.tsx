import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { InterestCardCode, InterestCardRegistry, InterestProfile } from "@/contracts";
import { MobileApiError } from "@/lib/mobile-api";
import { guestSubjects, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

type AnalyticsContext = { issueId: string; issueVersion: number };

export function InterestSelector({
  mode,
  analyticsContext,
}: {
  mode: "prompt" | "settings";
  analyticsContext?: AnalyticsContext;
}) {
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [registry, setRegistry] = useState<InterestCardRegistry | null>(null);
  const [profile, setProfile] = useState<InterestProfile | null>(null);
  const [selected, setSelected] = useState<InterestCardCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const analyticsSessionId = useRef(randomUUID());
  const promptRecorded = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      let currentSubject = await guestSubjects.getOrCreate();
      let loadedProfile: InterestProfile;
      try {
        loadedProfile = await mobileApi.loadInterestProfile(currentSubject);
      } catch (reason) {
        if (!(reason instanceof MobileApiError) || reason.code !== "GUEST_SUBJECT_NOT_FOUND") {
          throw reason;
        }
        currentSubject = await guestSubjects.rotate();
        loadedProfile = await mobileApi.loadInterestProfile(currentSubject);
      }
      const loadedRegistry = await mobileApi.loadInterestCards();
      if (!active) return;
      setSubjectId(currentSubject);
      setRegistry(loadedRegistry);
      setProfile(loadedProfile);
      setSelected(loadedProfile.selectedCardCodes);
    })()
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "관심 주제를 불러오지 못했습니다.");
        }
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
    void mobileApi
      .recordAnalyticsEvent({
        sessionId: analyticsSessionId.current,
        eventId: randomUUID(),
        eventType: "INTEREST_PROMPT_VIEW",
        occurredAt: new Date().toISOString(),
        ...analyticsContext,
      })
      .catch(() => undefined);
  }, [analyticsContext, shouldShowPrompt]);

  if (loading) {
    return mode === "settings" ? (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    ) : null;
  }
  if (mode === "prompt" && !shouldShowPrompt) return null;
  if (!subjectId || !registry || !profile) {
    return mode === "settings" ? <Text style={styles.error}>{error}</Text> : null;
  }

  function toggle(code: InterestCardCode) {
    setError(null);
    setMessage(null);
    setSelected((current) => {
      if (current.includes(code)) return current.filter((item) => item !== code);
      if (current.length >= registry!.maxSelections) {
        setError(`최대 ${registry!.maxSelections}개까지 선택할 수 있어요.`);
        return current;
      }
      return [...current, code];
    });
  }

  async function save() {
    if (selected.length < registry!.minSelections) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await mobileApi.saveInterestProfile({
        subjectId: subjectId!,
        selectedCardCodes: selected,
        onboardingState: "COMPLETED",
      });
      setProfile(updated);
      setSelected(updated.selectedCardCodes);
      setMessage("관심 주제를 저장했어요.");
      if (analyticsContext) {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "INTEREST_SELECTION_COMPLETE",
            occurredAt: new Date().toISOString(),
            ...analyticsContext,
          })
          .catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "관심 주제를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    setSaving(true);
    setError(null);
    try {
      setProfile(
        await mobileApi.saveInterestProfile({
          subjectId: subjectId!,
          selectedCardCodes: [],
          onboardingState: "SKIPPED",
        }),
      );
      setSelected([]);
      if (analyticsContext) {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "INTEREST_PROMPT_SKIP",
            occurredAt: new Date().toISOString(),
            ...analyticsContext,
          })
          .catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "나중에 하기를 처리하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      const updated = await mobileApi.resetInterestProfile(subjectId!);
      setProfile(updated);
      setSelected([]);
      setMessage("추천 관심 신호만 초기화했어요. 투표 기록은 유지됩니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "추천 설정을 초기화하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.panel, mode === "prompt" && styles.prompt]}>
      <Text style={styles.eyebrow}>YOUR INTERESTS</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {mode === "prompt" ? "다음 질문을 더 잘 골라드릴까요?" : "관심 주제 설정"}
      </Text>
      <Text style={styles.description}>
        관심 주제를 3개 이상 골라주세요. A/B 선택 방향은 관심 성향으로 저장하지 않아요.
      </Text>
      <View style={styles.grid}>
        {registry.cards.map((card) => {
          const active = selected.includes(card.code);
          return (
            <Pressable
              key={card.code}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: saving }}
              disabled={saving}
              onPress={() => toggle(card.code)}
              style={({ pressed }) => [
                styles.card,
                active && styles.cardActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.cardLabel, active && styles.cardLabelActive]}>{card.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.count}>
        {selected.length}/{registry.maxSelections} 선택
      </Text>
      <View style={styles.actions}>
        {mode === "prompt" ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void skip()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>나중에</Text>
          </Pressable>
        ) : profile.onboardingState !== "NOT_STARTED" ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void reset()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>추천 재설정</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || selected.length < registry.minSelections }}
          disabled={saving || selected.length < registry.minSelections}
          onPress={() => void save()}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>{saving ? "저장 중…" : "선택 저장"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { padding: 24 },
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 20,
  },
  prompt: { borderColor: colors.cyan, marginTop: 8 },
  eyebrow: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 25, fontWeight: "900", lineHeight: 32 },
  description: { color: "#5E7076", fontSize: 14, lineHeight: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardActive: { backgroundColor: colors.cyan, borderColor: colors.ink },
  cardLabel: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  cardLabelActive: { color: colors.ink },
  pressed: { opacity: 0.75 },
  count: { color: "#5E7076", fontSize: 12, fontWeight: "800", textAlign: "right" },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  primary: {
    backgroundColor: colors.ink,
    borderRadius: 14,
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryText: { color: colors.paper, fontWeight: "900" },
  secondary: {
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  secondaryText: { color: colors.ink, fontWeight: "900" },
  error: { color: "#9C2F00", fontSize: 13, fontWeight: "700" },
  message: { color: "#007780", fontSize: 13, fontWeight: "700" },
});
