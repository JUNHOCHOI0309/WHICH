import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "@/components/feedback/toast-provider";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.bg },
            headerStyle: { backgroundColor: colors.surface },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: "800" },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="me" options={{ headerShown: false }} />
          <Stack.Screen name="moderation" options={{ title: "내 Moderation" }} />
          <Stack.Screen name="interests" options={{ headerShown: false }} />
          <Stack.Screen name="create" options={{ title: "질문 만들기" }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
          <Stack.Screen name="issues/[issueId]" options={{ title: "투표" }} />
          <Stack.Screen name="comments/[issueId]" options={{ title: "선택 이유" }} />
          <Stack.Screen name="+not-found" options={{ title: "찾을 수 없음" }} />
        </Stack>
      </ToastProvider>
    </SafeAreaProvider>
  );
}
