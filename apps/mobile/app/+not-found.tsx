import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/theme";

export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>질문을 찾지 못했어요.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/")}
          style={styles.button}
        >
          <Text style={styles.buttonText}>피드로 돌아가기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.ink },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 24 },
  title: { color: colors.paper, fontSize: 28, fontWeight: "900" },
  button: { alignItems: "center", backgroundColor: colors.accent, borderRadius: 20, padding: 18 },
  buttonText: { color: colors.ink, fontSize: 16, fontWeight: "900" },
});
