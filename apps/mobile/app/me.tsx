import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  MemberPointLedgerItem,
  MemberPointView,
  MemberPrivateProfile,
  MemberSessionView,
} from "@/contracts";
import { memberSessions, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

const providerLabels = {
  EMAIL: "이메일",
  GOOGLE: "Google",
  X: "X",
  NAVER: "Naver",
  KAKAO: "Kakao",
  DEVELOPMENT: "개발 계정",
} as const;

function dateLabel(value: string, includeTime = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: includeTime ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: includeTime ? "numeric" : undefined,
    minute: includeTime ? "2-digit" : undefined,
  }).format(new Date(value));
}

function pointAmountLabel(item: MemberPointLedgerItem) {
  return `${item.amount > 0 ? "+" : ""}${item.amount.toLocaleString("ko-KR")}P`;
}

export default function MeScreen() {
  const [session, setSession] = useState<MemberSessionView | null>(null);
  const [profile, setProfile] = useState<MemberPrivateProfile | null>(null);
  const [points, setPoints] = useState<MemberPointView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void reloadKey;
      let active = true;
      setLoading(true);
      setError(false);

      void memberSessions
        .restore()
        .then(async (restored) => {
          if (!active) return;
          if (!restored) {
            router.replace("/login");
            return;
          }
          setSession(restored);
          const [nextProfile, nextPoints] = await Promise.all([
            mobileApi.loadMemberProfile(restored.token, { limit: 5 }),
            mobileApi.loadMemberPoints(restored.token, { limit: 5 }),
          ]);
          if (!active) return;
          setProfile(nextProfile);
          setPoints(nextPoints);
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });

      return () => {
        active = false;
      };
    }, [reloadKey]),
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.cyanStrong} size="large" />
        <Text style={styles.loadingText}>내 정보를 확인하고 있어요.</Text>
      </SafeAreaView>
    );
  }

  if (error || !session || !profile || !points) {
    return (
      <SafeAreaView style={styles.loading}>
        <Text style={styles.errorTitle}>내 정보를 불러오지 못했어요.</Text>
        <Text style={styles.loadingText}>연결 상태를 확인한 뒤 다시 시도해 주세요.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setReloadKey((current) => current + 1)}
          style={styles.retry}
        >
          <Text style={styles.retryText}>다시 불러오기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.brand}>
            <Text style={styles.brandW}>W</Text>HICH
          </Text>
          <Text style={styles.headerLabel}>내 정보</Text>
        </View>

        <View style={styles.profileCard}>
          {profile.member.avatar.kind === "IMAGE" ? (
            <Image source={{ uri: profile.member.avatar.url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarInitials}>
              <Text style={styles.avatarText}>{profile.member.avatar.initials}</Text>
            </View>
          )}
          <View style={styles.profileCopy}>
            <Text style={styles.eyebrow}>PRIVATE MEMBER PROFILE</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {profile.member.displayName}님의 선택
            </Text>
            <Text style={styles.description}>
              {dateLabel(profile.member.joinedAt)}부터 WHICH에 참여했어요.
            </Text>
          </View>
          <View style={styles.participation}>
            <Text style={styles.participationValue}>
              {profile.member.participationCount.toLocaleString("ko-KR")}
            </Text>
            <Text style={styles.participationLabel}>참여한 질문</Text>
          </View>
        </View>

        <View style={styles.pointCard}>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.eyebrow}>W POINT</Text>
              <Text style={styles.sectionTitle}>나의 W Point</Text>
            </View>
            <View style={styles.pointBalance}>
              <Text style={styles.pointBalanceValue}>
                {points.account.balance.toLocaleString("ko-KR")}P
              </Text>
              <Text style={styles.pointToday}>
                오늘 +{points.account.todayEarned.toLocaleString("ko-KR")}P
              </Text>
            </View>
          </View>
          {points.ledger.items.length ? (
            <View style={styles.ledger}>
              {points.ledger.items.map((item) => (
                <View key={item.id} style={styles.ledgerItem}>
                  <View style={styles.ledgerCopy}>
                    <Text style={styles.ledgerReason}>{item.reasonLabel}</Text>
                    <Text style={styles.ledgerDate}>{dateLabel(item.createdAt, true)}</Text>
                  </View>
                  <Text
                    style={[styles.ledgerAmount, item.amount < 0 && styles.ledgerAmountNegative]}
                  >
                    {pointAmountLabel(item)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>아직 W Point 내역이 없어요.</Text>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.eyebrow}>CONNECTED LOGIN</Text>
          <Text style={styles.sectionTitle}>연결된 로그인</Text>
          <View style={styles.identityList}>
            {profile.identities.map((identity) => (
              <View key={identity.provider} style={styles.identityChip}>
                <Text style={styles.identityText}>{providerLabels[identity.provider]}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.eyebrow}>VOTE RECORD</Text>
              <Text style={styles.sectionTitle}>최근 투표 기록</Text>
            </View>
            <Text style={styles.recordCount}>{profile.member.participationCount}개</Text>
          </View>
          {profile.votes.items.length ? (
            <View style={styles.voteList}>
              {profile.votes.items.map((vote) => (
                <Pressable
                  accessibilityRole="button"
                  key={vote.voteId}
                  onPress={() => router.push(`/issues/${vote.issueId}`)}
                  style={styles.voteItem}
                >
                  <View style={styles.voteChoice}>
                    <Text style={styles.voteChoiceText}>{vote.choice}</Text>
                  </View>
                  <View style={styles.voteCopy}>
                    <Text numberOfLines={2} style={styles.voteQuestion}>
                      {vote.question}
                    </Text>
                    <Text style={styles.voteMeta}>
                      {vote.choiceLabel} · {dateLabel(vote.acceptedAt)}
                    </Text>
                  </View>
                  <Text style={styles.voteArrow}>→</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>아직 계정에 연결된 투표 기록이 없어요.</Text>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/")}
          style={styles.home}
        >
          <Text style={styles.homeText}>Feed로 이동</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void memberSessions.logout().then(() => router.replace("/login"))}
          style={styles.logout}
        >
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  loading: {
    alignItems: "center",
    backgroundColor: colors.bg,
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  errorTitle: { color: colors.text, fontSize: 21, fontWeight: "900", textAlign: "center" },
  retry: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 28,
  },
  retryText: { color: "#062A31", fontSize: 15, fontWeight: "900" },
  content: { gap: 16, padding: 18, paddingBottom: 40 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  brand: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -1.4 },
  brandW: { color: colors.cyanStrong },
  headerLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  profileCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 20,
  },
  avatarImage: { borderRadius: 38, height: 76, width: 76 },
  avatarInitials: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 38,
    borderWidth: 1,
    height: 76,
    justifyContent: "center",
    width: 76,
  },
  avatarText: { color: colors.text, fontSize: 22, fontWeight: "900" },
  profileCopy: { alignItems: "center", gap: 6 },
  eyebrow: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "900",
    lineHeight: 32,
    textAlign: "center",
  },
  description: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center" },
  participation: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    borderRadius: 16,
    minWidth: 110,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  participationValue: { color: colors.cyanStrong, fontSize: 24, fontWeight: "900" },
  participationLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  pointCard: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 24,
    borderWidth: 1,
    gap: 16,
    padding: 20,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 20,
  },
  sectionHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 5 },
  pointBalance: { alignItems: "flex-end" },
  pointBalanceValue: { color: colors.text, fontSize: 24, fontWeight: "900" },
  pointToday: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900" },
  ledger: { borderTopColor: colors.borderStrong, borderTopWidth: 1 },
  ledgerItem: {
    alignItems: "center",
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 13,
  },
  ledgerCopy: { flex: 1, gap: 3 },
  ledgerReason: { color: colors.text, fontSize: 14, fontWeight: "800" },
  ledgerDate: { color: colors.textTertiary, fontSize: 11, fontWeight: "600" },
  ledgerAmount: { color: colors.cyanStrong, fontSize: 15, fontWeight: "900" },
  ledgerAmountNegative: { color: colors.orangeStrong },
  emptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  identityList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  identityChip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  identityText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  recordCount: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  voteList: { borderTopColor: colors.border, borderTopWidth: 1 },
  voteItem: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
  },
  voteChoice: {
    alignItems: "center",
    borderColor: colors.cyan,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  voteChoiceText: { color: colors.cyanStrong, fontSize: 14, fontWeight: "900" },
  voteCopy: { flex: 1, gap: 4 },
  voteQuestion: { color: colors.text, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  voteMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  voteArrow: { color: colors.cyanStrong, fontSize: 20, fontWeight: "900" },
  home: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 52,
  },
  homeText: { color: "#062A31", fontSize: 15, fontWeight: "900" },
  logout: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
  },
  logoutText: { color: colors.textSecondary, fontSize: 14, fontWeight: "800" },
});
