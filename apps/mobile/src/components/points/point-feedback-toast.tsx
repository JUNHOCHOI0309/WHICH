import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";

export type PointFeedback = { amount: number; reasonLabel: string };

export function PointFeedbackToast({
  feedback,
  onDismiss,
}: {
  feedback: PointFeedback | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(onDismiss, 2_600);
    return () => clearTimeout(timeout);
  }, [feedback, onDismiss]);

  if (!feedback) return null;
  return (
    <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.toast}>
      <Text style={styles.copy}>
        {feedback.reasonLabel} · +{feedback.amount}P
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    alignSelf: "center",
    backgroundColor: colors.text,
    borderRadius: 999,
    bottom: 82,
    elevation: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    zIndex: 20,
  },
  copy: { color: colors.surface, fontSize: 14, fontWeight: "900" },
});
