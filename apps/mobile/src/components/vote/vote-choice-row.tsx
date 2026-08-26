import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { IssueChoice } from "@/contracts";
import { colors } from "@/theme";

export function VoteChoiceRow({
  choice,
  selected = false,
  disabled = false,
  pending = false,
  onMediaLoad,
  onPress,
}: {
  choice: IssueChoice;
  selected?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onMediaLoad?: (outcome: "SUCCESS" | "FAILURE") => void;
  onPress: (choice: IssueChoice) => void;
}) {
  const isB = choice.code === "B";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${choice.code} 선택, ${choice.label}`}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => onPress(choice)}
      style={({ pressed }) => [
        styles.row,
        isB ? styles.rowB : styles.rowA,
        selected && (isB ? styles.selectedB : styles.selectedA),
        pressed && styles.pressed,
      ]}
    >
      <ChoiceMedia choice={choice} onMediaLoad={onMediaLoad} />
      <View style={styles.labelRow}>
        <View style={[styles.code, isB ? styles.codeB : styles.codeA]}>
          <Text style={styles.codeText}>{choice.code}</Text>
        </View>
        <Text style={styles.label}>{choice.label}</Text>
        {pending ? (
          <ActivityIndicator color={isB ? colors.orangeStrong : colors.cyanStrong} size="small" />
        ) : (
          <Text style={[styles.arrow, isB ? styles.arrowB : styles.arrowA]}>
            {selected ? "✓" : "→"}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function ChoiceMediaPair({
  choices,
  onMediaLoad,
}: {
  choices: IssueChoice[];
  onMediaLoad?: (choice: IssueChoice, outcome: "SUCCESS" | "FAILURE") => void;
}) {
  if (choices.length !== 2 || choices.some((choice) => !choice.media)) return null;
  return (
    <View style={styles.mediaPair}>
      {choices.map((choice) => (
        <View style={styles.mediaResult} key={choice.id}>
          <ChoiceMedia choice={choice} onMediaLoad={(outcome) => onMediaLoad?.(choice, outcome)} />
          <Text numberOfLines={1} style={styles.mediaLabel}>
            {choice.code} · {choice.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ChoiceMedia({
  choice,
  onMediaLoad,
}: {
  choice: IssueChoice;
  onMediaLoad?: (outcome: "SUCCESS" | "FAILURE") => void;
}) {
  const [failed, setFailed] = useState(false);
  if (!choice.media || failed) return null;
  return (
    <Image
      accessibilityLabel={choice.media.altText}
      source={{ uri: choice.media.url }}
      resizeMode={choice.media.cropMode === "CONTAIN" ? "contain" : "cover"}
      style={styles.media}
      onLoad={() => onMediaLoad?.("SUCCESS")}
      onError={() => {
        setFailed(true);
        onMediaLoad?.("FAILURE");
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    gap: 9,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  labelRow: { alignItems: "center", flexDirection: "row", gap: 11 },
  media: { aspectRatio: 16 / 9, backgroundColor: "#EEF3F5", borderRadius: 9, width: "100%" },
  mediaPair: { flexDirection: "row", gap: 10, marginBottom: 4, marginTop: 12 },
  mediaResult: { flex: 1, minWidth: 0 },
  mediaLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "700", marginTop: 5 },
  rowA: { borderColor: "#8EDCE6" },
  rowB: { borderColor: "#FFB79C" },
  selectedA: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  selectedB: { backgroundColor: colors.orangeSoft, borderColor: colors.orange },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  code: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  codeA: { borderColor: colors.cyan },
  codeB: { borderColor: colors.orange },
  codeText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  label: { color: colors.text, flex: 1, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  arrow: { fontSize: 18, fontWeight: "900" },
  arrowA: { color: colors.cyanStrong },
  arrowB: { color: colors.orangeStrong },
});
