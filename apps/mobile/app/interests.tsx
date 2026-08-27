import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InterestSelector } from "@/features/interests/interest-selector";
import { colors } from "@/theme";

export default function InterestsScreen() {
  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="WHICH 홈으로 이동"
          accessibilityRole="link"
          onPress={() => router.replace("/")}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.brand}>
            <Text style={styles.brandW}>W</Text>HICH
          </Text>
        </Pressable>
        <Text style={styles.headerLabel}>관심사</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <InterestSelector mode="settings" />
      </ScrollView>

      <View style={styles.bottomNav}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/")}
          style={styles.bottomNavItem}
        >
          <Text style={styles.bottomNavIcon}>⌂</Text>
          <Text style={styles.bottomNavText}>홈</Text>
        </Pressable>
        <View style={[styles.bottomNavItem, styles.bottomNavItemActive]}>
          <Text style={styles.bottomNavIconActive}>#</Text>
          <Text style={styles.bottomNavTextActive}>관심사</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/me")}
          style={styles.bottomNavItem}
        >
          <Text style={styles.bottomNavIcon}>◎</Text>
          <Text style={styles.bottomNavText}>내 기록</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: 20,
  },
  brand: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -1.4 },
  brandW: { color: colors.cyanStrong },
  headerLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.72 },
  content: { flexGrow: 1, padding: 18, paddingBottom: 28 },
  bottomNav: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    marginTop: "auto",
  },
  bottomNavItem: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 62,
  },
  bottomNavItemActive: { backgroundColor: colors.cyanSoft },
  bottomNavIcon: { color: colors.textTertiary, fontSize: 19 },
  bottomNavIconActive: { color: colors.cyanStrong, fontSize: 19 },
  bottomNavText: { color: colors.textSecondary, fontSize: 10, fontWeight: "700" },
  bottomNavTextActive: { color: colors.text, fontSize: 10, fontWeight: "900" },
});
