import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.ink },
          headerStyle: { backgroundColor: colors.ink },
          headerShadowVisible: false,
          headerTintColor: colors.paper,
          headerTitleStyle: { fontWeight: "800" },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="issues/[issueId]" options={{ title: "투표" }} />
        <Stack.Screen name="+not-found" options={{ title: "찾을 수 없음" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
