import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toast } from "@/components/feedback/toast";
import type { MemberModerationCenter, MemberSessionView } from "@/contracts";
import { MobileApiError } from "@/lib/mobile-api";
import { memberSessions, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

type Screen = "loading" | "guest" | "ready" | "error";
type RightsType = "PRIVACY" | "DEFAMATION" | "COPYRIGHT";
type PickedMedia = {
  uri: string;
  name: string;
  type: "image/jpeg" | "image/png" | "image/webp";
};

const statusLabels: Record<string, string> = {
  PENDING: "검수 대기",
  APPROVED: "승인",
  REJECTED: "반려",
  HIDDEN: "숨김",
  DELETED: "삭제",
  NEEDS_CHANGES: "수정 필요",
  SUBMITTED: "접수",
  IN_REVIEW: "사람 검토 중",
  UPHELD: "기존 조치 유지",
  OVERTURNED: "조치 변경·복원",
  ACTIONED: "보호 조치 완료",
  DISMISSED: "종결",
  CANCELLED: "취소",
  WITHDRAWN: "철회",
};

function dateTime(value: string | null) {
  if (!value) return "기한 별도 안내";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof MobileApiError ? error.message || fallback : fallback;
}

export default function ModerationScreen() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [session, setSession] = useState<MemberSessionView | null>(null);
  const [center, setCenter] = useState<MemberModerationCenter | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [appealTarget, setAppealTarget] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [rightsTarget, setRightsTarget] = useState<string | null>(null);
  const [rightsType, setRightsType] = useState<RightsType>("COPYRIGHT");
  const [rightsDetails, setRightsDetails] = useState("");
  const [replacementTarget, setReplacementTarget] = useState<string | null>(null);
  const [replacementA, setReplacementA] = useState<PickedMedia | null>(null);
  const [replacementB, setReplacementB] = useState<PickedMedia | null>(null);
  const [attestation, setAttestation] = useState("");

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const restored = await memberSessions.restore();
      if (!restored) {
        setSession(null);
        setCenter(null);
        setScreen("guest");
        return;
      }
      setSession(restored);
      setCenter(await mobileApi.loadMemberModeration(restored.token));
      setScreen("ready");
    } catch {
      setScreen("error");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadKey;
      void load();
    }, [load, reloadKey]),
  );

  const pendingCount = useMemo(
    () => center?.assets.filter((asset) => asset.assetReview.status === "PENDING").length ?? 0,
    [center],
  );

  async function refresh() {
    if (!session) return;
    setCenter(await mobileApi.loadMemberModeration(session.token));
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      Alert.alert("Moderation", errorMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function chooseAlternative(submissionId: string, action: "TEXT_ONLY" | "CANCEL_IMAGE") {
    if (!session) return;
    await run(async () => {
      await mobileApi.chooseModerationAssetAlternative(session.token, submissionId, { action });
      toast.success(
        action === "TEXT_ONLY" ? "이미지 없이 검토를 계속해요." : "이미지를 질문에서 제외했어요.",
      );
    }, "이미지 대안을 적용하지 못했습니다.");
  }

  async function applyLibrary(submissionId: string) {
    if (!session || !center || center.libraryAssets.length < 2) return;
    await run(async () => {
      await mobileApi.chooseModerationAssetAlternative(session.token, submissionId, {
        action: "APPROVED_LIBRARY",
        replacementAssetAId: center.libraryAssets[0]!.assetId,
        replacementAssetBId: center.libraryAssets[1]!.assetId,
      });
      toast.success("승인된 Library 이미지로 교체했어요.");
    }, "Library 이미지 교체에 실패했습니다.");
  }

  async function pickReplacement(side: "A" | "B") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("사진 접근 권한", "교체 이미지를 선택하려면 사진 접근을 허용해 주세요.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.9,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      Alert.alert("이미지가 너무 커요", "10MB 이하 JPG, PNG 또는 WebP 이미지를 선택해 주세요.");
      return;
    }
    const type: PickedMedia["type"] =
      asset.mimeType === "image/png"
        ? "image/png"
        : asset.mimeType === "image/webp"
          ? "image/webp"
          : "image/jpeg";
    const next = {
      uri: asset.uri,
      name:
        asset.fileName ??
        `which-moderation-${side.toLowerCase()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`,
      type,
    };
    if (side === "A") setReplacementA(next);
    else setReplacementB(next);
  }

  async function replaceImages(submissionId: string) {
    if (!session || !replacementA || !replacementB || attestation.trim().length < 20) {
      Alert.alert("이미지 변경", "A/B 이미지와 20자 이상의 권리 확인을 입력해 주세요.");
      return;
    }
    await run(async () => {
      const [assetA, assetB] = await Promise.all([
        mobileApi.uploadMemberIssueMedia(session.token, replacementA, attestation.trim()),
        mobileApi.uploadMemberIssueMedia(session.token, replacementB, attestation.trim()),
      ]);
      await mobileApi.chooseModerationAssetAlternative(session.token, submissionId, {
        action: "REPLACE_IMAGE",
        replacementAssetAId: assetA.asset.id,
        replacementAssetBId: assetB.asset.id,
      });
      setReplacementTarget(null);
      setReplacementA(null);
      setReplacementB(null);
      setAttestation("");
      toast.success("새 이미지를 검수 대상으로 제출했어요.");
    }, "이미지 교체에 실패했습니다.");
  }

  async function submitAppeal(assetId: string) {
    if (!session || appealReason.trim().length < 20) {
      Alert.alert("재검토 요청", "재검토 이유를 20자 이상 입력해 주세요.");
      return;
    }
    await run(async () => {
      await mobileApi.submitModerationAppeal(session.token, {
        targetType: "ISSUE_MEDIA_ASSET",
        targetId: assetId,
        reason: appealReason.trim(),
      });
      setAppealTarget(null);
      setAppealReason("");
      toast.success("사람 재검토를 요청했어요.");
    }, "재검토 요청에 실패했습니다.");
  }

  async function submitRights(assetId: string) {
    if (!session || rightsDetails.trim().length < 20) {
      Alert.alert("권리 요청", "권리 요청 내용을 20자 이상 입력해 주세요.");
      return;
    }
    await run(async () => {
      await mobileApi.submitModerationRights(session.token, {
        requestType: rightsType,
        targetType: "ISSUE_MEDIA_ASSET",
        targetId: assetId,
        details: rightsDetails.trim(),
      });
      setRightsTarget(null);
      setRightsDetails("");
      toast.success("권리 요청을 별도 사건으로 접수했어요.");
    }, "권리 요청에 실패했습니다.");
  }

  if (screen === "loading")
    return <MessageState loading title="Moderation 상태를 확인하고 있어요." />;
  if (screen === "guest") {
    return (
      <MessageState
        action="로그인"
        onPress={() => router.push("/login?returnTo=%2Fmoderation")}
        title="로그인하면 내 Moderation 상태를 확인할 수 있어요."
      />
    );
  }
  if (screen === "error" || !center || !session) {
    return (
      <MessageState
        action="다시 불러오기"
        onPress={() => setReloadKey((value) => value + 1)}
        title="Moderation 상태를 불러오지 못했어요."
      />
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>MY MODERATION</Text>
          <Text style={styles.title}>조치 이유와 다음 단계를 투명하게 확인해요.</Text>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount}건 검수 대기</Text>
          </View>
        </View>

        <Section title="이미지와 질문 상태" caption="Issue 게시와 Asset 검수는 별도로 진행됩니다.">
          {center.assets.length === 0 ? (
            <Empty text="검수 중이거나 조치된 이미지가 없습니다." />
          ) : (
            center.assets.map((asset) => (
              <View key={asset.assetId} style={styles.assetCard}>
                <View style={styles.cardHeading}>
                  <View style={styles.cardHeadingText}>
                    <Text style={styles.status}>{statusLabels[asset.assetReview.status]}</Text>
                    <Text style={styles.cardTitle}>
                      {asset.issueSubmission?.question ?? "질문 연결 전 이미지"}
                    </Text>
                  </View>
                  <Text style={styles.time}>{dateTime(asset.assetReview.lastChangedAt)}</Text>
                </View>
                <InfoRow
                  label="Issue 게시"
                  value={
                    asset.issueSubmission
                      ? (statusLabels[asset.issueSubmission.publicationStatus] ??
                        asset.issueSubmission.publicationStatus)
                      : "연결 전"
                  }
                />
                <InfoRow
                  label="Asset 검수"
                  value={statusLabels[asset.assetReview.status] ?? asset.assetReview.status}
                />
                <InfoRow
                  label="정책·이유"
                  value={`${asset.assetReview.policyVersion} · ${asset.assetReview.reasonCode}`}
                />
                <InfoRow label="제출 시각" value={dateTime(asset.assetReview.submittedAt)} />

                {asset.assetReview.status === "PENDING" && asset.issueSubmission ? (
                  <View style={styles.actionGrid}>
                    <ActionButton
                      disabled={busy}
                      label="Text-only로 계속"
                      onPress={() => void chooseAlternative(asset.issueSubmission!.id, "TEXT_ONLY")}
                    />
                    {center.libraryAssets.length >= 2 ? (
                      <ActionButton
                        disabled={busy}
                        label="승인 Library 교체"
                        onPress={() => void applyLibrary(asset.issueSubmission!.id)}
                      />
                    ) : null}
                    <ActionButton
                      disabled={busy}
                      label="이미지 변경"
                      onPress={() => setReplacementTarget(asset.issueSubmission!.id)}
                    />
                    <ActionButton
                      disabled={busy}
                      label="이미지 취소"
                      onPress={() =>
                        void chooseAlternative(asset.issueSubmission!.id, "CANCEL_IMAGE")
                      }
                    />
                  </View>
                ) : null}

                {replacementTarget === asset.issueSubmission?.id ? (
                  <View style={styles.form}>
                    <Text style={styles.formTitle}>교체 이미지</Text>
                    <View style={styles.actionGrid}>
                      <ActionButton
                        label={replacementA ? "A 선택됨" : "A 이미지 선택"}
                        onPress={() => void pickReplacement("A")}
                      />
                      <ActionButton
                        label={replacementB ? "B 선택됨" : "B 이미지 선택"}
                        onPress={() => void pickReplacement("B")}
                      />
                    </View>
                    <TextInput
                      multiline
                      onChangeText={setAttestation}
                      placeholder="직접 촬영했거나 게시 권리를 보유한 이미지임을 확인합니다."
                      placeholderTextColor={colors.textTertiary}
                      style={styles.textarea}
                      value={attestation}
                    />
                    <ActionButton
                      emphasis
                      disabled={busy}
                      label="변경 이미지 제출"
                      onPress={() => void replaceImages(asset.issueSubmission!.id)}
                    />
                  </View>
                ) : null}

                {["REJECTED", "HIDDEN", "DELETED"].includes(asset.assetReview.status) ? (
                  <View style={styles.actionGrid}>
                    <ActionButton
                      disabled={busy || Boolean(asset.appealId)}
                      label={asset.appealId ? "재검토 접수됨" : "사람 재검토 요청"}
                      onPress={() => setAppealTarget(asset.assetId)}
                    />
                    <ActionButton
                      disabled={busy}
                      label="Rights 절차"
                      onPress={() => setRightsTarget(asset.assetId)}
                    />
                  </View>
                ) : null}

                {appealTarget === asset.assetId ? (
                  <View style={styles.form}>
                    <Text style={styles.formTitle}>재검토 이유</Text>
                    <TextInput
                      multiline
                      onChangeText={setAppealReason}
                      placeholder="조치를 다시 검토해야 하는 이유를 20자 이상 적어 주세요."
                      placeholderTextColor={colors.textTertiary}
                      style={styles.textarea}
                      value={appealReason}
                    />
                    <ActionButton
                      emphasis
                      disabled={busy}
                      label="재검토 접수"
                      onPress={() => void submitAppeal(asset.assetId)}
                    />
                  </View>
                ) : null}

                {rightsTarget === asset.assetId ? (
                  <View style={styles.form}>
                    <Text style={styles.formTitle}>권리 유형</Text>
                    <View style={styles.choiceRow}>
                      {(["PRIVACY", "DEFAMATION", "COPYRIGHT"] as const).map((type) => (
                        <Pressable
                          key={type}
                          onPress={() => setRightsType(type)}
                          style={[styles.choice, rightsType === type && styles.choiceActive]}
                        >
                          <Text
                            style={[
                              styles.choiceText,
                              rightsType === type && styles.choiceTextActive,
                            ]}
                          >
                            {type === "PRIVACY"
                              ? "개인정보"
                              : type === "DEFAMATION"
                                ? "명예훼손"
                                : "저작권"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      multiline
                      onChangeText={setRightsDetails}
                      placeholder="요청 및 증빙 설명을 20자 이상 적어 주세요."
                      placeholderTextColor={colors.textTertiary}
                      style={styles.textarea}
                      value={rightsDetails}
                    />
                    <ActionButton
                      emphasis
                      disabled={busy}
                      label="권리 사건 접수"
                      onPress={() => void submitRights(asset.assetId)}
                    />
                  </View>
                ) : null}
              </View>
            ))
          )}
        </Section>

        <Section
          title="통지와 최종 결과"
          caption="신고자와 내부 탐지 세부사항은 공개하지 않습니다."
        >
          {center.notices.length === 0 ? (
            <Empty text="새 통지가 없습니다." />
          ) : (
            center.notices.map((notice) => (
              <View key={notice.id} style={styles.notice}>
                <Text style={styles.noticeTitle}>{notice.summary}</Text>
                <Text style={styles.noticeBody}>{notice.nextStep}</Text>
                <Text style={styles.time}>
                  {notice.reasonCode} · {dateTime(notice.effectiveAt)}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="제품 재검토" caption="APPEAL">
          {center.appeals.length === 0 ? (
            <Empty text="접수된 재검토 요청이 없습니다." />
          ) : (
            center.appeals.map((item) => (
              <View key={item.id} style={styles.caseItem}>
                <Text style={styles.caseStatus}>{statusLabels[item.status]}</Text>
                <Text style={styles.noticeBody}>{item.resolution ?? item.reason}</Text>
                <Text style={styles.time}>{dateTime(item.updatedAt)}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title="권리 사건" caption="RIGHTS">
          {center.rightsCases.length === 0 ? (
            <Empty text="접수된 권리 사건이 없습니다." />
          ) : (
            center.rightsCases.map((item) => (
              <View key={item.id} style={styles.caseItem}>
                <Text style={styles.caseStatus}>
                  {item.requestType} · {statusLabels[item.status]}
                </Text>
                <Text style={styles.noticeBody}>{item.resolution ?? item.details}</Text>
                <Text style={styles.time}>
                  처리 목표 {dateTime(item.dueAt)} · Legal hold {dateTime(item.legalHoldUntil)}
                </Text>
              </View>
            ))
          )}
        </Section>
      </ScrollView>
      {busy ? (
        <View style={styles.busy} pointerEvents="none">
          <ActivityIndicator color={colors.cyanStrong} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MessageState({
  action,
  loading = false,
  onPress,
  title,
}: {
  action?: string;
  loading?: boolean;
  onPress?: () => void;
  title: string;
}) {
  return (
    <SafeAreaView style={styles.messageState}>
      {loading ? <ActivityIndicator color={colors.cyanStrong} /> : null}
      <Text style={styles.messageTitle}>{title}</Text>
      {action && onPress ? <ActionButton emphasis label={action} onPress={onPress} /> : null}
    </SafeAreaView>
  );
}

function Section({
  caption,
  children,
  title,
}: {
  caption: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{caption}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  disabled = false,
  emphasis = false,
  label,
  onPress,
}: {
  disabled?: boolean;
  emphasis?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        emphasis && styles.actionEmphasis,
        (pressed || disabled) && styles.actionMuted,
      ]}
    >
      <Text style={[styles.actionText, emphasis && styles.actionTextEmphasis]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { gap: 18, padding: 18, paddingBottom: 48 },
  hero: {
    gap: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 22,
  },
  eyebrow: { color: colors.cyanStrong, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", lineHeight: 36 },
  pendingBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: colors.cyanSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pendingBadgeText: { color: colors.cyanStrong, fontSize: 13, fontWeight: "800" },
  section: {
    gap: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
  },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  sectionBody: { gap: 12, marginTop: 10 },
  assetCard: {
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    padding: 15,
  },
  cardHeading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardHeadingText: { flex: 1, gap: 5 },
  status: { color: colors.orangeStrong, fontSize: 12, fontWeight: "900" },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "800", lineHeight: 25 },
  time: { color: colors.textTertiary, fontSize: 11, lineHeight: 16 },
  infoRow: {
    flexDirection: "row",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 9,
  },
  infoLabel: { width: 78, color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  infoValue: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 18 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  action: {
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  actionEmphasis: { borderColor: colors.cyan, backgroundColor: colors.cyan },
  actionMuted: { opacity: 0.5 },
  actionText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  actionTextEmphasis: { color: colors.text },
  form: { gap: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 13 },
  formTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  textarea: {
    minHeight: 100,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: 13,
    textAlignVertical: "top",
  },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  choiceActive: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  choiceText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  choiceTextActive: { color: colors.cyanStrong },
  notice: { gap: 5, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9 },
  noticeTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  noticeBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  caseItem: { gap: 5, borderRadius: 14, backgroundColor: colors.surfaceSubtle, padding: 13 },
  caseStatus: { color: colors.cyanStrong, fontSize: 13, fontWeight: "900" },
  empty: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, paddingVertical: 12 },
  busy: {
    position: "absolute",
    top: 12,
    right: 14,
    borderRadius: 999,
    backgroundColor: colors.surface,
    padding: 10,
  },
  messageState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    backgroundColor: colors.bg,
    padding: 28,
  },
  messageTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 31,
    textAlign: "center",
  },
});
