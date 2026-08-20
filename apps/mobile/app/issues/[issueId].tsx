import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { IssueChoice, PublicIssue, VoteResponse } from "@/contracts";
import { InterestSelector } from "@/features/interests/interest-selector";
import { MobileApiError } from "@/lib/mobile-api";
import { guestSubjects, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

function percentage(value: number, total: number) {
  return total === 0 ? 0 : Math.round((value / total) * 100);
}

export default function IssueScreen() {
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [vote, setVote] = useState<VoteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingChoice, setSubmittingChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextIssueState, setNextIssueState] = useState<"idle" | "loading" | "empty" | "error">(
    "idle",
  );
  const attemptKey = useRef(randomUUID());
  const analyticsSessionId = useRef(randomUUID());

  const fetchIssue = useCallback(async () => {
    if (!issueId) throw new Error("질문 ID가 필요합니다.");
    return mobileApi.loadIssue(issueId);
  }, [issueId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIssue(await fetchIssue());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "질문을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [fetchIssue]);

  useEffect(() => {
    let active = true;
    void fetchIssue()
      .then((loaded) => {
        if (active) setIssue(loaded);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "질문을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchIssue]);

  async function submit(choice: IssueChoice) {
    if (!issue || submittingChoice || vote) return;
    setSubmittingChoice(choice.id);
    setError(null);
    try {
      let subjectId = await guestSubjects.getOrCreate();
      const command = {
        issueId: issue.id,
        issueVersion: issue.version,
        choiceId: choice.id,
        idempotencyKey: attemptKey.current,
      };
      try {
        setVote(await mobileApi.submitGuestVote({ ...command, subjectId }));
      } catch (reason) {
        if (!(reason instanceof MobileApiError) || reason.code !== "GUEST_SUBJECT_NOT_FOUND") {
          throw reason;
        }
        subjectId = await guestSubjects.rotate();
        setVote(await mobileApi.submitGuestVote({ ...command, subjectId }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "투표를 전송하지 못했습니다.");
    } finally {
      setSubmittingChoice(null);
    }
  }

  async function moveNext() {
    if (!issue || nextIssueState === "loading") return;
    setNextIssueState("loading");
    try {
      const subjectId = await guestSubjects.getOrCreate();
      const feed = await mobileApi.loadFeed(subjectId, 1, issue.id);
      const nextIssue = feed.items[0];
      if (!nextIssue) {
        setNextIssueState("empty");
        return;
      }
      if (feed.ranking.mode === "PERSONALIZED") {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "PERSONALIZED_ISSUE_OPEN",
            issueId: nextIssue.id,
            issueVersion: nextIssue.version,
            recommendationRequestId: nextIssue.recommendation.requestId,
            occurredAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      router.push({ pathname: "/issues/[issueId]", params: { issueId: nextIssue.id } });
      setNextIssueState("idle");
    } catch {
      setNextIssueState("error");
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!issue) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "질문을 찾지 못했습니다."}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const result = vote?.result ?? issue.result.tally;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.category}>{issue.categoryCode}</Text>
        <Text accessibilityRole="header" style={styles.question}>
          {issue.question}
        </Text>
        {issue.context ? <Text style={styles.context}>{issue.context}</Text> : null}

        <View style={styles.choices}>
          {issue.choices.map((choice) => (
            <Pressable
              key={choice.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(submittingChoice || vote) }}
              disabled={Boolean(submittingChoice || vote)}
              onPress={() => void submit(choice)}
              style={({ pressed }) => [
                styles.choice,
                choice.code === "B" && styles.choiceB,
                pressed && styles.choicePressed,
                vote?.choice === choice.code && styles.choiceSelected,
              ]}
            >
              <Text style={styles.choiceCode}>{choice.code}</Text>
              <Text style={styles.choiceLabel}>{choice.label}</Text>
              {submittingChoice === choice.id ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <Text style={styles.choiceArrow}>→</Text>
              )}
            </Pressable>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {result ? (
          <>
            <View style={styles.resultCard}>
              <Text style={styles.resultEyebrow}>
                {vote?.outcome === "REJECTED_DUPLICATE" ? "이미 반영된 선택" : "실시간 결과"}
              </Text>
              <View style={styles.resultRow}>
                <Text style={styles.resultA}>
                  A {percentage(result.acceptedA, result.displayedTotal)}%
                </Text>
                <Text style={styles.resultB}>
                  B {percentage(result.acceptedB, result.displayedTotal)}%
                </Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.trackA,
                    { width: `${percentage(result.acceptedA, result.displayedTotal)}%` },
                  ]}
                />
              </View>
              <Text style={styles.total}>
                {result.displayedTotal.toLocaleString("ko-KR")}명 참여
              </Text>
            </View>
            <InterestSelector
              mode="prompt"
              analyticsContext={{ issueId: issue.id, issueVersion: issue.version }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={nextIssueState === "loading"}
              onPress={() => void moveNext()}
              style={({ pressed }) => [styles.nextIssue, pressed && styles.choicePressed]}
            >
              <Text style={styles.nextIssueText}>
                {nextIssueState === "loading" ? "다음 질문을 찾는 중…" : "다음 질문 보기 →"}
              </Text>
            </Pressable>
            {nextIssueState === "empty" ? (
              <Text style={styles.nextIssueMessage}>지금 참여할 수 있는 질문을 모두 골랐어요.</Text>
            ) : null}
            {nextIssueState === "error" ? (
              <Text style={styles.error}>다음 질문을 찾지 못했습니다. 다시 시도해 주세요.</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.locked}>결과는 투표 후 공개됩니다.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  content: { gap: 22, padding: 20, paddingBottom: 48 },
  center: {
    alignItems: "center",
    backgroundColor: colors.ink,
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 24,
  },
  category: { color: colors.cyan, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  question: { color: colors.paper, fontSize: 34, fontWeight: "900", lineHeight: 43 },
  context: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  choices: { gap: 12, marginTop: 8 },
  choice: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 24,
    flexDirection: "row",
    gap: 14,
    minHeight: 112,
    padding: 22,
  },
  choiceB: { backgroundColor: colors.accent },
  choicePressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  choiceSelected: { borderColor: colors.paper, borderWidth: 3 },
  choiceCode: {
    backgroundColor: colors.ink,
    borderRadius: 18,
    color: colors.paper,
    fontSize: 16,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  choiceLabel: { color: colors.ink, flex: 1, fontSize: 22, fontWeight: "900" },
  choiceArrow: { color: colors.ink, fontSize: 28, fontWeight: "900" },
  error: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
  },
  retry: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  retryText: { color: colors.ink, fontWeight: "900" },
  resultCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    gap: 18,
    marginTop: 8,
    padding: 22,
  },
  resultEyebrow: { color: colors.accent, fontSize: 13, fontWeight: "900" },
  resultRow: { flexDirection: "row", justifyContent: "space-between" },
  resultA: { color: colors.cyan, fontSize: 26, fontWeight: "900" },
  resultB: { color: colors.accent, fontSize: 26, fontWeight: "900" },
  track: { backgroundColor: colors.accent, borderRadius: 999, height: 8, overflow: "hidden" },
  trackA: { backgroundColor: colors.cyan, height: "100%" },
  total: { color: colors.muted, fontSize: 13, textAlign: "right" },
  nextIssue: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 20,
    minHeight: 60,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  nextIssueText: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  nextIssueMessage: { color: colors.muted, fontSize: 14, textAlign: "center" },
  locked: { color: colors.muted, fontSize: 14, textAlign: "center" },
});
