import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/theme";

import { toast, type ToastInput, type ToastTone } from "./toast";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

const MAX_TOASTS = 2;
let nextToastId = 0;

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const present = useCallback(
    (input: ToastInput) => {
      const tone = input.tone ?? "info";
      const item: ToastItem = {
        id: ++nextToastId,
        message: input.message,
        tone,
        durationMs: input.durationMs ?? (tone === "error" ? 5_000 : 3_200),
      };

      setItems((current) => {
        if (current.some((existing) => existing.message === item.message)) return current;
        return [...current, item].slice(-MAX_TOASTS);
      });
      timers.current.set(
        item.id,
        setTimeout(() => dismiss(item.id), item.durationMs),
      );
    },
    [dismiss],
  );

  useEffect(() => toast.subscribe(present), [present]);
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return (
    <View style={styles.root}>
      {children}
      <View pointerEvents="box-none" style={[styles.viewport, { top: insets.top + 12 }]}>
        {items.map((item) => (
          <View
            accessibilityLiveRegion={item.tone === "error" ? "assertive" : "polite"}
            key={item.id}
            style={[styles.item, stylesByTone[item.tone]]}
          >
            <Text style={[styles.icon, iconStylesByTone[item.tone]]}>
              {item.tone === "success" ? "✓" : item.tone === "error" ? "!" : "i"}
            </Text>
            <Text style={styles.message}>{item.message}</Text>
            <Pressable
              accessibilityLabel="알림 닫기"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => dismiss(item.id)}
              style={styles.close}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  viewport: {
    gap: 8,
    left: 14,
    position: "absolute",
    right: 14,
    zIndex: 100,
  },
  item: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 10,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: "#000000",
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  success: { borderLeftColor: "#1F9D78" },
  info: { borderLeftColor: colors.cyanStrong },
  error: { borderLeftColor: colors.orange },
  icon: {
    borderRadius: 12,
    fontSize: 12,
    fontWeight: "900",
    height: 22,
    lineHeight: 22,
    marginRight: 10,
    textAlign: "center",
    width: 22,
  },
  iconSuccess: { backgroundColor: "#E8F6F2", color: "#14785D" },
  iconInfo: { backgroundColor: colors.cyanSoft, color: colors.cyanStrong },
  iconError: { backgroundColor: colors.orangeSoft, color: colors.orange },
  message: { color: colors.text, flex: 1, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  close: { alignItems: "center", height: 32, justifyContent: "center", marginLeft: 8, width: 32 },
  closeText: { color: colors.textSecondary, fontSize: 24, lineHeight: 26 },
});

const stylesByTone: Record<ToastTone, object> = {
  success: styles.success,
  info: styles.info,
  error: styles.error,
};

const iconStylesByTone: Record<ToastTone, object> = {
  success: styles.iconSuccess,
  info: styles.iconInfo,
  error: styles.iconError,
};
