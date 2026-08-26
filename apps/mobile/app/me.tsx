import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { MemberSessionView } from "@/contracts";
import { memberSessions } from "@/lib/runtime";
import { colors } from "@/theme";

export default function MeScreen() {
  const [session, setSession] = useState<MemberSessionView | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void memberSessions
        .restore()
        .then((restored) => {
          if (!active) return;
          if (!restored) router.replace("/login");
          else setSession(restored);
        })
        .catch(() => {
          if (active) router.replace("/login");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  if (loading || !session) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.cyanStrong} size="large" />
        <Text style={styles.loadingText}>내 기록을 확인하고 있어요.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.brand}>
          <Text style={styles.brandW}>W</Text>HICH
        </Text>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>NATIVE MEMBER</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {session.member.displayName}님의 내 기록
          </Text>
          <Text style={styles.description}>
            Native Member Session이 안전하게 연결됐습니다. 상세 프로필과 W Point는 다음 단계에서 이
            화면에 이어집니다.
          </Text>
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
      </View>
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
  },
  loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
  content: { flex: 1, gap: 18, padding: 22 },
  brand: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -1.4 },
  brandW: { color: colors.cyanStrong },
  card: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 24,
  },
  eyebrow: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", lineHeight: 36 },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },
  home: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    minHeight: 52,
    justifyContent: "center",
  },
  homeText: { color: "#062A31", fontSize: 15, fontWeight: "900" },
  logout: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: "center",
  },
  logoutText: { color: colors.textSecondary, fontSize: 14, fontWeight: "800" },
});
