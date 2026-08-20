import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { PublicFeedIssue, PublicIssueFeed } from "@/contracts";
import { guestSubjects, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

export default function FeedScreen() {
  const [issues, setIssues] = useState<PublicFeedIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<PublicIssueFeed["ranking"] | null>(null);
  const analyticsSessionId = useRef(randomUUID());
  const viewedRecommendationRequests = useRef(new Set<string>());

  const fetchFeed = useCallback(async () => {
    const subjectId = await guestSubjects.getOrCreate();
    const feed = await mobileApi.loadFeed(subjectId, 12);
    const firstIssue = feed.items[0];
    if (
      firstIssue &&
      feed.ranking.mode === "PERSONALIZED" &&
      !viewedRecommendationRequests.current.has(feed.ranking.requestId)
    ) {
      viewedRecommendationRequests.current.add(feed.ranking.requestId);
      void mobileApi
        .recordAnalyticsEvent({
          sessionId: analyticsSessionId.current,
          eventId: randomUUID(),
          eventType: "PERSONALIZED_FEED_VIEW",
          issueId: firstIssue.id,
          issueVersion: firstIssue.version,
          recommendationRequestId: feed.ranking.requestId,
          occurredAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
    return feed;
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const feed = await fetchFeed();
        setIssues(feed.items);
        setRanking(feed.ranking);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "피드를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchFeed],
  );

  useEffect(() => {
    let active = true;
    void fetchFeed()
      .then((feed) => {
        if (active) {
          setIssues(feed.items);
          setRanking(feed.ranking);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "피드를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchFeed]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <FlatList
        data={issues}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text accessibilityRole="header" style={styles.brand}>
                WHICH
              </Text>
              <Pressable accessibilityRole="button" onPress={() => router.push("/interests")}>
                <Text style={styles.interestLink}>관심사 설정</Text>
              </Pressable>
            </View>
            <Text style={styles.eyebrow}>MOBILE FIRST</Text>
            <Text style={styles.title}>고르고, 결과를 보고, 다음 질문으로.</Text>
            {ranking?.mode === "PERSONALIZED" ? (
              <Text style={styles.personalizedBadge}>관심사 기반 추천</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} size="large" />
          ) : (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>{error ?? "지금 참여할 질문이 없습니다."}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void load()}
                style={styles.retry}
              >
                <Text style={styles.retryText}>다시 불러오기</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.question} 투표 열기`}
            onPress={() => {
              if (ranking?.mode === "PERSONALIZED") {
                void mobileApi
                  .recordAnalyticsEvent({
                    sessionId: analyticsSessionId.current,
                    eventId: randomUUID(),
                    eventType: "PERSONALIZED_ISSUE_OPEN",
                    issueId: item.id,
                    issueVersion: item.version,
                    recommendationRequestId: item.recommendation.requestId,
                    occurredAt: new Date().toISOString(),
                  })
                  .catch(() => undefined);
              }
              router.push({ pathname: "/issues/[issueId]", params: { issueId: item.id } });
            }}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardMeta}>
              <Text style={styles.category}>{item.categoryCode}</Text>
              <Text style={styles.sequence}>{String(index + 1).padStart(2, "0")}</Text>
            </View>
            <Text style={styles.question}>{item.question}</Text>
            <View style={styles.previewRow}>
              {item.choices.map((choice) => (
                <View key={choice.id} style={styles.previewChoice}>
                  <Text style={styles.previewCode}>{choice.code}</Text>
                  <Text numberOfLines={1} style={styles.previewLabel}>
                    {choice.label}
                  </Text>
                </View>
              ))}
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 48 },
  header: { gap: 12, paddingBottom: 32, paddingTop: 18 },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  brand: { color: colors.paper, fontSize: 30, fontWeight: "900", letterSpacing: -1 },
  interestLink: { color: colors.cyan, fontSize: 13, fontWeight: "900" },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "900", letterSpacing: 2 },
  title: { color: colors.paper, fontSize: 34, fontWeight: "900", lineHeight: 42, maxWidth: 340 },
  personalizedBadge: {
    alignSelf: "flex-start",
    borderColor: colors.cyan,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 28,
    borderWidth: 1,
    gap: 26,
    padding: 24,
  },
  cardPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  cardMeta: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  category: { color: colors.cyan, fontSize: 12, fontWeight: "800" },
  sequence: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  question: { color: colors.paper, fontSize: 26, fontWeight: "900", lineHeight: 34 },
  previewRow: { flexDirection: "row", gap: 10 },
  previewChoice: {
    alignItems: "center",
    backgroundColor: colors.panelSoft,
    borderRadius: 16,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 56,
    padding: 12,
  },
  previewCode: { color: colors.accent, fontSize: 13, fontWeight: "900" },
  previewLabel: { color: colors.paper, flex: 1, fontSize: 14, fontWeight: "700" },
  separator: { height: 14 },
  stateCard: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderRadius: 24,
    gap: 18,
    padding: 28,
  },
  stateTitle: { color: colors.paper, fontSize: 18, fontWeight: "800", textAlign: "center" },
  retry: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  retryText: { color: colors.ink, fontWeight: "900" },
});
