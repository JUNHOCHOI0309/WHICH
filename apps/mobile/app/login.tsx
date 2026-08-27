import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { authenticateInSystemBrowser } from "@/lib/native-auth-browser";
import type { NativeAuthProvider } from "@/lib/native-auth";
import { guestSubjects, nativeAuth } from "@/lib/runtime";
import { colors } from "@/theme";

const methods: { provider: NativeAuthProvider; label: string; description: string }[] = [
  { provider: "email", label: "이메일로 계속하기", description: "가입·로그인·이메일 확인" },
  { provider: "google", label: "Google로 계속하기", description: "Google 계정" },
  { provider: "x", label: "X로 계속하기", description: "X 계정" },
  { provider: "naver", label: "네이버로 계속하기", description: "네이버 계정" },
  { provider: "kakao", label: "카카오로 계속하기", description: "카카오 계정" },
];

const providerLabels: Record<NativeAuthProvider, string> = {
  email: "이메일",
  google: "Google",
  x: "X",
  naver: "네이버",
  kakao: "카카오",
};

export default function LoginScreen() {
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const [lastProvider, setLastProvider] = useState<NativeAuthProvider | null>(null);
  const [pending, setPending] = useState<NativeAuthProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void nativeAuth.lastProvider().then(setLastProvider);
  }, []);

  async function authenticate(provider: NativeAuthProvider) {
    setPending(provider);
    setMessage(null);
    try {
      const anonymousSubjectId = await guestSubjects.getOrCreate();
      const requestedReturnTo = Array.isArray(params.returnTo)
        ? params.returnTo[0]
        : params.returnTo;
      const completion = await authenticateInSystemBrowser(
        nativeAuth,
        provider,
        anonymousSubjectId,
        requestedReturnTo,
      );
      if (!completion) {
        setMessage("로그인을 취소했어요. 현재 화면에서 다시 시도할 수 있어요.");
        return;
      }
      setLastProvider(provider);
      router.replace(completion.returnTo ?? "/me");
    } catch {
      setMessage("로그인을 완료하지 못했어요. Feed는 그대로 유지되니 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }

  function startAuthentication(provider: NativeAuthProvider, isLast: boolean) {
    if (!isLast) {
      void authenticate(provider);
      return;
    }

    Alert.alert(
      "최근 사용한 로그인",
      `${providerLabels[provider]}에 로그인 상태가 남아 있으면 같은 계정으로 바로 연결될 수 있어요. 계속할까요?`,
      [
        { text: "다른 방식 선택", style: "cancel" },
        { text: "같은 계정으로 계속", onPress: () => void authenticate(provider) },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Feed로 돌아가기</Text>
        </Pressable>

        <View style={styles.heading}>
          <Text style={styles.brand}>
            <Text style={styles.brandW}>W</Text>HICH
          </Text>
          <Text accessibilityRole="header" style={styles.title}>
            내 선택을 계정에 이어 두세요.
          </Text>
          <Text style={styles.description}>
            시스템 브라우저에서 안전하게 인증한 뒤 앱의 내 기록 탭으로 돌아옵니다.
          </Text>
        </View>

        <View style={styles.methods}>
          {methods.map((method) => {
            const isLast = lastProvider === method.provider;
            const isPending = pending === method.provider;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={pending !== null}
                key={method.provider}
                onPress={() => startAuthentication(method.provider, isLast)}
                style={({ pressed }) => [
                  styles.method,
                  method.provider === "x" && styles.methodX,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.methodCopy}>
                  <Text
                    style={[styles.methodLabel, method.provider === "x" && styles.methodLabelX]}
                  >
                    {isPending ? "브라우저 여는 중…" : method.label}
                  </Text>
                  <Text
                    style={[
                      styles.methodDescription,
                      method.provider === "x" && styles.methodDescriptionX,
                    ]}
                  >
                    {method.description}
                  </Text>
                </View>
                {isLast ? (
                  <Text style={styles.lastUsed}>최근 사용</Text>
                ) : (
                  <Text style={[styles.arrow, method.provider === "x" && styles.arrowX]}>→</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {lastProvider ? (
          <Text style={styles.hint}>
            최근 사용 수단은 같은 계정으로 바로 연결될 수 있어요. 다른 계정이면 다른 수단을
            선택해 주세요.
          </Text>
        ) : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {message}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync("https://whichone.site/forgot-password")}
          style={styles.recovery}
        >
          <Text style={styles.recoveryText}>비밀번호 재설정·이메일 확인 도움받기 ↗</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: 24, padding: 22, paddingBottom: 48 },
  back: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center" },
  backText: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  heading: { gap: 12 },
  brand: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -1.4 },
  brandW: { color: colors.cyanStrong },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", lineHeight: 36 },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 23 },
  methods: { gap: 10 },
  method: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  methodX: { backgroundColor: "#000000", borderColor: "#000000" },
  methodCopy: { gap: 3 },
  methodLabel: { color: colors.text, fontSize: 16, fontWeight: "900" },
  methodLabelX: { color: "#ffffff" },
  methodDescription: { color: colors.textSecondary, fontSize: 11 },
  methodDescriptionX: { color: "#d7d7d7" },
  lastUsed: { color: colors.cyanStrong, fontSize: 10, fontWeight: "900" },
  arrow: { color: colors.text, fontSize: 17, fontWeight: "900" },
  arrowX: { color: "#ffffff" },
  hint: { color: colors.cyanStrong, fontSize: 12, fontWeight: "800", textAlign: "center" },
  message: {
    backgroundColor: colors.orangeSoft,
    borderLeftColor: colors.orange,
    borderLeftWidth: 4,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    padding: 14,
  },
  recovery: { alignItems: "center", minHeight: 46, justifyContent: "center" },
  recoveryText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.995 }] },
});
