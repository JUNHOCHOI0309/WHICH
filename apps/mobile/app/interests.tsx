import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InterestSelector } from "@/features/interests/interest-selector";
import { colors } from "@/theme";

export default function InterestsScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← 돌아가기</Text>
        </Pressable>
        <InterestSelector mode="settings" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.ink, flex: 1 },
  content: { gap: 18, padding: 20, paddingBottom: 48 },
  back: { alignSelf: "flex-start", paddingVertical: 8 },
  backText: { color: colors.paper, fontSize: 15, fontWeight: "900" },
});
