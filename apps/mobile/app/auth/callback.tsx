import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toast } from "@/components/feedback/toast";
import { nativeAuth } from "@/lib/runtime";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function NativeAuthCallbackScreen() {
  const params = useLocalSearchParams<{
    ticket?: string | string[];
    state?: string | string[];
    nonce?: string | string[];
    error?: string | string[];
  }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const ticket = first(params.ticket);
  const state = first(params.state);
  const nonce = first(params.nonce);
  const callbackError = first(params.error);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const callback = new URL("which://auth/callback");
    const callbackParams = { ticket, state, nonce, error: callbackError };
    for (const key of ["ticket", "state", "nonce", "error"] as const) {
      const value = callbackParams[key];
      if (value) callback.searchParams.set(key, value);
    }
    void nativeAuth
      .complete(callback.toString())
      .then((completion) => {
        toast.success("로그인에 성공했습니다.");
        router.replace(completion.returnTo ?? "/me");
      })
      .catch(() => setError("로그인을 완료하지 못했습니다. 다시 시도해 주세요."));
  }, [callbackError, nonce, router, state, ticket]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        {error ? (
          <>
            <Text style={styles.title}>로그인을 이어갈 수 없어요.</Text>
            <Text style={styles.body}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace("/login")}>
              <Text style={styles.action}>로그인 화면으로 돌아가기</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator color="#0897a8" size="large" />
            <Text style={styles.title}>WHICH 계정을 연결하고 있어요.</Text>
            <Text style={styles.body}>이 화면을 닫지 말고 잠시만 기다려 주세요.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f5f7f8",
  },
  card: {
    gap: 18,
    borderWidth: 1,
    borderColor: "#c9d4d8",
    borderRadius: 24,
    padding: 28,
    backgroundColor: "#ffffff",
  },
  title: { color: "#071b24", fontSize: 24, fontWeight: "900" },
  body: { color: "#61727a", fontSize: 16, lineHeight: 24 },
  action: { color: "#0897a8", fontSize: 17, fontWeight: "800" },
});
