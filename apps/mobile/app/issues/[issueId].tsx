import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BalanceResultBar } from "@/components/vote/balance-result-bar";
import { VoteChoiceRow } from "@/components/vote/vote-choice-row";
import type { IssueChoice, PublicIssue, VoteResponse } from "@/contracts";
import { InterestSelector } from "@/features/interests/interest-selector";
import { MobileApiError } from "@/lib/mobile-api";
import { guestSubjects, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

export default function IssueScreen() {
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const [issue, setIssue] = useState<PublicIssue | null>(null);
  const [vote, setVote] = useState<VoteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingChoice, setSubmittingChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeChoice, setIncludeChoice] = useState(false);
  const [sharing, setSharing] = useState(false);
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

  useEffect(() => {
    if (!issue || !vote) return;
    void mobileApi
      .recordAnalyticsEvent({
        sessionId: analyticsSessionId.current,
        eventId: randomUUID(),
        eventType: "SHARE_OPEN",
        issueId: issue.id,
        issueVersion: issue.version,
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }, [issue, vote]);

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

  async function shareResult() {
    if (!issue || !vote || sharing) return;
    setSharing(true);
    setError(null);
    try {
      const created = await mobileApi.createResultShareCard({
        issueId: issue.id,
        issueVersion: issue.version,
        resultVersion: vote.result.resultVersion,
        channel: "SYSTEM",
        ...(includeChoice ? { sharedChoiceCode: vote.choice } : {}),
      });
      const outcome = await Share.share({
        title: issue.question,
        message: `${issue.question}\n${created.url}`,
        url: created.url,
      });
      if (outcome.action === Share.sharedAction) {
        void mobileApi
          .recordAnalyticsEvent({
            sessionId: analyticsSessionId.current,
            eventId: randomUUID(),
            eventType: "SHARE_COMPLETE",
            issueId: issue.id,
            issueVersion: issue.version,
            shareCardId: created.shareCard.id,
            occurredAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "공유 링크를 만들지 못했습니다.");
    } finally {
      setSharing(false);
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
            <VoteChoiceRow
              key={choice.id}
              choice={choice}
              disabled={Boolean(submittingChoice || vote)}
              pending={submittingChoice === choice.id}
              selected={vote?.choice === choice.code}
              onPress={(selected) => void submit(selected)}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {result ? (
          <>
            <View style={styles.resultCard}>
              <Text style={styles.resultEyebrow}>
                {vote?.outcome === "REJECTED_DUPLICATE" ? "이미 반영된 선택" : "실시간 결과"}
              </Text>
              {vote ? (
                <Text style={styles.myVoteNotice}>
                  ✓ 당신은 “
                  {issue.choices.find((choice) => choice.code === vote.choice)?.label ??
                    vote.choice}
                  ”에 투표했어요.
                </Text>
              ) : null}
              <BalanceResultBar
                aLabel={issue.choices.find((choice) => choice.code === "A")?.label ?? "A"}
                bLabel={issue.choices.find((choice) => choice.code === "B")?.label ?? "B"}
                acceptedA={result.acceptedA}
                acceptedB={result.acceptedB}
                selectedChoice={vote?.choice ?? "A"}
              />
            </View>
            {vote ? (
              <View style={styles.shareCard}>
                <Text style={styles.shareTitle}>결과 공유</Text>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: includeChoice }}
                  onPress={() => {
                    setIncludeChoice((current) => !current);
                    void mobileApi
                      .recordAnalyticsEvent({
                        sessionId: analyticsSessionId.current,
                        eventId: randomUUID(),
                        eventType: "SHARE_CHOICE_TOGGLE",
                        issueId: issue.id,
                        issueVersion: issue.version,
                        occurredAt: new Date().toISOString(),
                      })
                      .catch(() => undefined);
                  }}
                  style={styles.shareToggle}
                >
                  <Text style={styles.shareToggleMark}>{includeChoice ? "✓" : "○"}</Text>
                  <Text style={styles.shareToggleText}>내가 고른 {vote.choice}도 함께 공개</Text>
                </Pressable>
                <Text style={styles.sharePrivacy}>
                  기본값은 비공개이며 계정 정보는 링크에 포함되지 않아요.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={sharing}
                  onPress={() => void shareResult()}
                  style={({ pressed }) => [styles.shareButton, pressed && styles.choicePressed]}
                >
                  <Text style={styles.shareButtonText}>
                    {sharing ? "공유 준비 중…" : "결과 공유하기"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
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
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { gap: 18, padding: 16, paddingBottom: 48 },
  center: {
    alignItems: "center",
    backgroundColor: colors.bg,
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 24,
  },
  category: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  question: { color: colors.text, fontSize: 27, fontWeight: "900", lineHeight: 35 },
  context: { color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
  choices: { gap: 10, marginTop: 4 },
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
    backgroundColor: colors.cyan,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  retryText: { color: "#062A31", fontWeight: "900" },
  resultCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 18,
    marginTop: 8,
    padding: 22,
  },
  resultEyebrow: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
  myVoteNotice: {
    backgroundColor: colors.cyanSoft,
    borderColor: "#B7EAF0",
    borderRadius: 11,
    borderWidth: 1,
    color: colors.cyanStrong,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    padding: 11,
  },
  resultRow: { flexDirection: "row", justifyContent: "space-between" },
  resultA: { color: colors.cyan, fontSize: 26, fontWeight: "900" },
  resultB: { color: colors.accent, fontSize: 26, fontWeight: "900" },
  track: { backgroundColor: colors.accent, borderRadius: 999, height: 8, overflow: "hidden" },
  trackA: { backgroundColor: colors.cyan, height: "100%" },
  total: { color: colors.muted, fontSize: 13, textAlign: "right" },
  shareCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  shareTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  shareToggle: { alignItems: "center", flexDirection: "row", gap: 9 },
  shareToggleMark: { color: colors.cyan, fontSize: 20, fontWeight: "900" },
  shareToggleText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  sharePrivacy: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  shareButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minHeight: 52,
    justifyContent: "center",
  },
  shareButtonText: { color: "#062A31", fontSize: 15, fontWeight: "900" },
  nextIssue: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minHeight: 60,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  nextIssueText: { color: "#062A31", fontSize: 16, fontWeight: "900" },
  nextIssueMessage: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  locked: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
});
