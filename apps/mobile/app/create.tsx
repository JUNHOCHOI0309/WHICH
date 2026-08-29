import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { toast } from "@/components/feedback/toast";
import type { InterestCardCode, IssueMediaLibraryPair, MemberIssueSubmission } from "@/contracts";
import { memberSessions, mobileApi } from "@/lib/runtime";
import { subjectStorage } from "@/lib/secure-subject-storage";
import { colors } from "@/theme";

const DRAFT_KEY = "which_mobile_issue_draft_v1";
const RIGHTS_ATTESTATION =
  "본인은 이 이미지를 사용할 권리를 보유했으며 WHICH 운영 검수와 게시에 동의합니다.";

type DraftMedia = {
  uri?: string;
  name?: string;
  type?: "image/jpeg" | "image/png" | "image/webp";
  assetId?: string;
};

type Draft = {
  version: 1;
  idempotencyKey: string;
  submissionId?: string;
  expectedRevision?: number;
  question: string;
  context: string;
  choiceA: string;
  choiceB: string;
  mediaA?: DraftMedia;
  mediaB?: DraftMedia;
  libraryPairId?: string;
  rightsConfirmed?: boolean;
  interestCardCode: InterestCardCode | null;
};

const emptyDraft = (): Draft => ({
  version: 1,
  idempotencyKey: randomUUID(),
  question: "",
  context: "",
  choiceA: "",
  choiceB: "",
  interestCardCode: null,
});

function parseDraft(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Draft;
    return parsed.version === 1 && parsed.idempotencyKey ? parsed : null;
  } catch {
    return null;
  }
}

const statusLabel: Record<MemberIssueSubmission["status"], string> = {
  PENDING: "검수 대기",
  APPROVED: "승인",
  NEEDS_CHANGES: "수정 요청",
  REJECTED: "반려",
};

export default function CreateIssueScreen() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [cards, setCards] = useState<{ code: InterestCardCode; label: string }[]>([]);
  const [submissions, setSubmissions] = useState<MemberIssueSubmission[]>([]);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await memberSessions.restore().catch(() => null);
    setSessionToken(session?.token ?? null);
    const [stored, registry] = await Promise.all([
      subjectStorage.getItem(DRAFT_KEY),
      mobileApi.loadInterestCards(),
    ]);
    setDraft(parseDraft(stored) ?? emptyDraft());
    setCards(registry.cards.map(({ code, label }) => ({ code, label })));
    if (session) {
      const [submissionResult, libraryResult] = await Promise.all([
        mobileApi.loadMemberIssueSubmissions(session.token).catch(() => null),
        mobileApi.loadIssueMediaLibrary(session.token).catch(() => null),
      ]);
      setSubmissions(submissionResult?.items ?? []);
      setLibrary(libraryResult?.items ?? []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      void subjectStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, loading]);

  const canSubmit = useMemo(() => {
    const hasA = Boolean(draft.mediaA?.uri || draft.mediaA?.assetId);
    const hasB = Boolean(draft.mediaB?.uri || draft.mediaB?.assetId);
    const hasLibrary = Boolean(draft.libraryPairId);
    return (
      sessionToken &&
      draft.question.trim().length >= 5 &&
      draft.choiceA.trim() &&
      draft.choiceB.trim() &&
      draft.choiceA.trim() !== draft.choiceB.trim() &&
      draft.interestCardCode &&
      hasA === hasB &&
      !(hasLibrary && (hasA || hasB)) &&
      (!hasA || draft.rightsConfirmed === true)
    );
  }, [draft, sessionToken]);

  async function persistDraft(next: Draft) {
    setDraft(next);
    await subjectStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  }

  async function chooseMedia(side: "A" | "B") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("사진 접근 권한", "선택지 이미지를 고르려면 사진 접근을 허용해 주세요.");
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
    const type: DraftMedia["type"] =
      asset.mimeType === "image/png"
        ? "image/png"
        : asset.mimeType === "image/webp"
          ? "image/webp"
          : "image/jpeg";
    const media: DraftMedia = {
      uri: asset.uri,
      name:
        asset.fileName ??
        `which-choice-${side.toLowerCase()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`,
      type,
    };
    await persistDraft({
      ...draft,
      libraryPairId: undefined,
      [side === "A" ? "mediaA" : "mediaB"]: media,
    });
  }

  async function uploadDraftMedia(current: Draft, side: "A" | "B") {
    const key = side === "A" ? "mediaA" : "mediaB";
    const media = current[key];
    if (!media || media.assetId) return current;
    if (!media.uri || !media.name || !media.type) {
      throw new Error(`${side} 선택지 이미지를 다시 선택해 주세요.`);
    }
    const result = await mobileApi.uploadMemberIssueMedia(
      sessionToken!,
      { uri: media.uri, name: media.name, type: media.type },
      RIGHTS_ATTESTATION,
    );
    const next = { ...current, [key]: { ...media, assetId: result.asset.id } };
    await persistDraft(next);
    return next;
  }

  async function submit() {
    if (!sessionToken || !draft.interestCardCode || !canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (draft.libraryPairId) {
        const result = await mobileApi.createMemberIssue(sessionToken, draft.idempotencyKey, {
          question: draft.question,
          context: draft.context.trim() || null,
          choiceA: draft.choiceA,
          choiceB: draft.choiceB,
          libraryPairId: draft.libraryPairId,
          interestCardCode: draft.interestCardCode,
        });
        await subjectStorage.removeItem(DRAFT_KEY);
        setDraft(emptyDraft());
        toast.success("승인 Library 이미지와 함께 질문을 게시했어요.");
        router.replace("/issues/" + result.issue.id);
        return;
      }
      let prepared = draft;
      prepared = await uploadDraftMedia(prepared, "A");
      prepared = await uploadDraftMedia(prepared, "B");
      const content = {
        question: prepared.question,
        context: prepared.context.trim() || null,
        choiceA: prepared.choiceA,
        choiceB: prepared.choiceB,
        mediaAssetAId: prepared.mediaA?.assetId ?? null,
        mediaAssetBId: prepared.mediaB?.assetId ?? null,
        interestCardCode: prepared.interestCardCode!,
      };
      const result =
        draft.submissionId && draft.expectedRevision
          ? await mobileApi.resubmitMemberIssue(
              sessionToken,
              draft.submissionId,
              draft.idempotencyKey,
              { ...content, expectedRevision: draft.expectedRevision },
            )
          : await mobileApi.submitMemberIssue(sessionToken, draft.idempotencyKey, content);
      await subjectStorage.removeItem(DRAFT_KEY);
      setDraft(emptyDraft());
      setSubmissions((current) => [
        result.submission,
        ...current.filter((item) => item.id !== result.submission.id),
      ]);
      toast.success(
        draft.submissionId
          ? `v${result.submission.revision} 수정본을 다시 제출했어요.`
          : "질문을 운영 검수로 제출했어요.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "질문을 제출하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function editSubmission(submission: MemberIssueSubmission) {
    setDraft({
      version: 1,
      idempotencyKey: randomUUID(),
      submissionId: submission.id,
      expectedRevision: submission.revision,
      question: submission.question,
      context: submission.context ?? "",
      choiceA: submission.choiceA,
      choiceB: submission.choiceB,
      mediaA: submission.mediaAssetAId ? { assetId: submission.mediaAssetAId } : undefined,
      mediaB: submission.mediaAssetBId ? { assetId: submission.mediaAssetBId } : undefined,
      rightsConfirmed: Boolean(submission.mediaAssetAId && submission.mediaAssetBId),
      interestCardCode: submission.interestCardCode,
    });
    toast.info(`v${submission.revision} 수정 요청 내용을 편집합니다.`);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.cyanStrong} />
      </SafeAreaView>
    );
  }

  if (!sessionToken) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.guestCard}>
          <Text style={styles.eyebrow}>CREATE AN ISSUE</Text>
          <Text style={styles.title}>질문 작성은 로그인 후 이용할 수 있어요.</Text>
          <Text style={styles.help}>로그인해도 작성 중인 초안은 이 기기에 그대로 남습니다.</Text>
          <Pressable onPress={() => router.push("/login")} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>로그인 또는 빠른 회원가입</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>MEMBER ISSUE</Text>
            <Text style={styles.title}>
              {draft.submissionId
                ? `v${draft.expectedRevision} 수정 요청을 반영해 주세요.`
                : "둘 중 하나를 고르는 질문을 만들어 보세요."}
            </Text>
            <Text style={styles.help}>제출 후 운영 검수를 통과해야 공개됩니다.</Text>
          </View>

          <Field
            label="질문"
            maxLength={120}
            onChangeText={(question) => setDraft((current) => ({ ...current, question }))}
            placeholder="예: 여행에서 하나만 더 중요하다면?"
            value={draft.question}
          />
          <Field
            label="짧은 설명 (선택)"
            maxLength={240}
            multiline
            onChangeText={(context) => setDraft((current) => ({ ...current, context }))}
            placeholder="비용과 일정은 비슷하다고 가정해 주세요."
            value={draft.context}
          />
          <View style={styles.choiceRow}>
            <Field
              compact
              label="A 선택지"
              maxLength={50}
              onChangeText={(choiceA) => setDraft((current) => ({ ...current, choiceA }))}
              placeholder="숙소의 편안함"
              value={draft.choiceA}
            />
            <Field
              compact
              label="B 선택지"
              maxLength={50}
              onChangeText={(choiceB) => setDraft((current) => ({ ...current, choiceB }))}
              placeholder="먹거리 만족도"
              value={draft.choiceB}
            />
          </View>

          <View style={styles.mediaRow}>
            <ChoiceMedia
              label="A 이미지 (선택)"
              media={draft.mediaA}
              onPress={() => void chooseMedia("A")}
            />
            <ChoiceMedia
              label="B 이미지 (선택)"
              media={draft.mediaB}
              onPress={() => void chooseMedia("B")}
            />
          </View>
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>이미지 방식</Text>
            <View style={styles.mediaModeRow}>
              <Pressable
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    libraryPairId: undefined,
                    mediaA: undefined,
                    mediaB: undefined,
                    rightsConfirmed: undefined,
                  }))
                }
                style={[styles.chip, !draft.libraryPairId && styles.chipSelected]}
              >
                <Text style={[styles.chipText, !draft.libraryPairId && styles.chipTextSelected]}>
                  텍스트 / 직접 업로드
                </Text>
              </Pressable>
              <Pressable
                disabled={library.length === 0}
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    libraryPairId: current.libraryPairId ?? library[0]?.id,
                    mediaA: undefined,
                    mediaB: undefined,
                    rightsConfirmed: undefined,
                  }))
                }
                style={[styles.chip, library.length === 0 && styles.buttonDisabled]}
              >
                <Text style={styles.chipText}>승인 이미지 Library</Text>
              </Pressable>
            </View>
            {library.length ? (
              <ScrollView
                horizontal
                contentContainerStyle={styles.libraryList}
                showsHorizontalScrollIndicator={false}
              >
                {library.map((pair) => (
                  <Pressable
                    key={pair.id}
                    onPress={() =>
                      setDraft((current) => ({
                        ...current,
                        libraryPairId: pair.id,
                        mediaA: undefined,
                        mediaB: undefined,
                        rightsConfirmed: undefined,
                      }))
                    }
                    style={[
                      styles.libraryCard,
                      draft.libraryPairId === pair.id && styles.libraryCardSelected,
                    ]}
                  >
                    <View style={styles.libraryImages}>
                      {pair.assets.map((asset) => (
                        <Image
                          key={asset.id}
                          source={{ uri: asset.url }}
                          style={styles.libraryImage}
                        />
                      ))}
                    </View>
                    <Text numberOfLines={1} style={styles.libraryTitle}>
                      {pair.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.help}>현재 사용할 수 있는 승인 이미지 쌍이 없습니다.</Text>
            )}
          </View>
          {draft.mediaA || draft.mediaB ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.rightsConfirmed === true }}
              onPress={() =>
                setDraft((current) => ({
                  ...current,
                  rightsConfirmed: !current.rightsConfirmed,
                }))
              }
              style={styles.rightsRow}
            >
              <View style={[styles.checkbox, draft.rightsConfirmed && styles.checkboxChecked]}>
                <Text style={styles.checkboxText}>{draft.rightsConfirmed ? "✓" : ""}</Text>
              </View>
              <Text style={styles.rightsText}>
                직접 촬영했거나 사용할 권리가 있는 이미지이며 운영 검수에 동의합니다.
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.fieldLabel}>관심 주제</Text>
            <View style={styles.chips}>
              {cards.map((card) => {
                const selected = draft.interestCardCode === card.code;
                return (
                  <Pressable
                    accessibilityState={{ selected }}
                    key={card.code}
                    onPress={() =>
                      setDraft((current) => ({ ...current, interestCardCode: card.code }))
                    }
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {card.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.draftNotice}>
            <Text style={styles.draftNoticeTitle}>자동 임시저장</Text>
            <Text style={styles.help}>
              네트워크 오류가 나도 같은 제출 건으로 안전하게 재시도합니다.
            </Text>
          </View>

          <Pressable
            accessibilityState={{ disabled: !canSubmit || submitting }}
            disabled={!canSubmit || submitting}
            onPress={() => void submit()}
            style={[styles.primaryButton, (!canSubmit || submitting) && styles.buttonDisabled]}
          >
            <Text style={styles.primaryButtonText}>{submitting ? "제출 중…" : "검수 요청"}</Text>
          </Pressable>

          {submissions.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>최근 제출 상태</Text>
              {submissions.map((submission) => (
                <View key={submission.id} style={styles.submissionCard}>
                  <View style={styles.submissionHeader}>
                    <Text style={styles.submissionStatus}>{statusLabel[submission.status]}</Text>
                    <Text style={styles.submissionRevision}>v{submission.revision}</Text>
                  </View>
                  <Text style={styles.submissionQuestion}>{submission.question}</Text>
                  {submission.reviewNote ? (
                    <Text style={styles.reviewNote}>{submission.reviewNote}</Text>
                  ) : null}
                  {submission.status === "NEEDS_CHANGES" ? (
                    <Pressable
                      onPress={() => editSubmission(submission)}
                      style={styles.revisionButton}
                    >
                      <Text style={styles.revisionButtonText}>수정해서 다시 제출</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChoiceMedia({
  label,
  media,
  onPress,
}: {
  label: string;
  media?: DraftMedia;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.mediaPicker}>
      {media?.uri ? <Image source={{ uri: media.uri }} style={styles.mediaPreview} /> : null}
      <Text style={styles.mediaLabel}>{label}</Text>
      <Text style={styles.mediaState}>
        {media?.assetId ? "업로드 완료 · 변경" : media?.uri ? "선택됨 · 변경" : "이미지 선택"}
      </Text>
    </Pressable>
  );
}

function Field({
  compact,
  label,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & { compact?: boolean; label: string }) {
  return (
    <View style={[styles.field, compact && styles.fieldCompact]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, inputProps.multiline && styles.inputMultiline]}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  centered: { alignItems: "center", backgroundColor: colors.bg, flex: 1, justifyContent: "center" },
  content: { gap: 16, padding: 18, paddingBottom: 48 },
  intro: { gap: 8, paddingVertical: 4 },
  eyebrow: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 25, fontWeight: "900", lineHeight: 33 },
  help: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  field: { gap: 8 },
  fieldCompact: { flex: 1 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "900" },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: "top" },
  choiceRow: { flexDirection: "row", gap: 10 },
  mediaRow: { flexDirection: "row", gap: 10 },
  mediaModeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mediaPicker: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderStyle: "dashed",
    borderWidth: 1,
    flex: 1,
    gap: 5,
    justifyContent: "center",
    minHeight: 104,
    overflow: "hidden",
    padding: 10,
  },
  mediaPreview: { height: 104, width: "120%" },
  mediaLabel: { color: colors.text, fontSize: 12, fontWeight: "900" },
  mediaState: { color: colors.cyanStrong, fontSize: 11, fontWeight: "800" },
  libraryList: { gap: 10, paddingVertical: 2 },
  libraryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 8,
    width: 180,
  },
  libraryCardSelected: { borderColor: colors.cyan, borderWidth: 2 },
  libraryImages: {
    borderRadius: 9,
    flexDirection: "row",
    height: 92,
    overflow: "hidden",
  },
  libraryImage: { flex: 1, height: 92 },
  libraryTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  rightsRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  checkbox: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 5,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  checkboxChecked: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  checkboxText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  rightsText: { color: colors.textSecondary, flex: 1, fontSize: 12, lineHeight: 18 },
  section: { gap: 12, marginTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  chipSelected: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "800" },
  chipTextSelected: { color: colors.cyanStrong },
  draftNotice: { backgroundColor: colors.cyanSoft, borderRadius: 14, gap: 4, padding: 14 },
  draftNoticeTitle: { color: colors.cyanStrong, fontSize: 13, fontWeight: "900" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: "#062A31", fontSize: 15, fontWeight: "900" },
  buttonDisabled: { backgroundColor: colors.borderStrong },
  guestCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 18,
    margin: 18,
    padding: 24,
  },
  submissionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  submissionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  submissionStatus: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900" },
  submissionRevision: { color: colors.textTertiary, fontSize: 11, fontWeight: "800" },
  submissionQuestion: { color: colors.text, fontSize: 15, fontWeight: "900", lineHeight: 21 },
  reviewNote: {
    backgroundColor: colors.orangeSoft,
    color: colors.orangeStrong,
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  revisionButton: {
    alignItems: "center",
    borderColor: colors.cyan,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  revisionButtonText: { color: colors.cyanStrong, fontSize: 13, fontWeight: "900" },
});
