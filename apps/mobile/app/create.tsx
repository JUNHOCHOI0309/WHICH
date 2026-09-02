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
import type {
  InterestCardCode,
  IssueMediaLibraryPair,
  IssueMediaUploadAccess,
  MemberIssueSubmission,
} from "@/contracts";
import { memberSessions, mobileApi } from "@/lib/runtime";
import { subjectStorage } from "@/lib/secure-subject-storage";
import { colors } from "@/theme";

const DRAFT_KEY = "which_mobile_issue_draft_v1";
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
  choiceC?: string;
  choiceD?: string;
  mediaContext?: DraftMedia;
  mediaA?: DraftMedia;
  mediaB?: DraftMedia;
  mediaC?: DraftMedia;
  mediaD?: DraftMedia;
  libraryPairId?: string;
  libraryAssetIds?: string[];
  interestCardCode: InterestCardCode | null;
};
type MediaTarget = "CONTEXT" | "A" | "B" | "C" | "D";
const CHOICE_CODES = ["A", "B", "C", "D"] as const;
const choiceKey = (code: (typeof CHOICE_CODES)[number]) =>
  `choice${code}` as "choiceA" | "choiceB" | "choiceC" | "choiceD";
const mediaKey = (target: MediaTarget) =>
  target === "CONTEXT"
    ? ("mediaContext" as const)
    : (`media${target}` as "mediaA" | "mediaB" | "mediaC" | "mediaD");

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
  CANCELLED: "취소됨",
};
const libraryAssignmentStyle = {
  A: { borderColor: colors.cyan, borderWidth: 2 },
  B: { borderColor: colors.orange, borderWidth: 2 },
  C: { borderColor: "#8467D7", borderWidth: 2 },
  D: { borderColor: "#5D9C59", borderWidth: 2 },
} as const;

export default function CreateIssueScreen() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [cards, setCards] = useState<{ code: InterestCardCode; label: string }[]>([]);
  const [submissions, setSubmissions] = useState<MemberIssueSubmission[]>([]);
  const [library, setLibrary] = useState<IssueMediaLibraryPair[]>([]);
  const [mediaAccess, setMediaAccess] = useState<IssueMediaUploadAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<string | null>(null);

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
      const [submissionResult, libraryResult, accessResult] = await Promise.all([
        mobileApi.loadMemberIssueSubmissions(session.token).catch(() => null),
        mobileApi.loadIssueMediaLibrary(session.token).catch(() => null),
        mobileApi.loadIssueMediaUploadAccess(session.token).catch(() => null),
      ]);
      setSubmissions(submissionResult?.items ?? []);
      setLibrary(libraryResult?.items ?? []);
      setMediaAccess(accessResult?.access ?? null);
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

  const activeChoiceCodes = CHOICE_CODES.filter(
    (code) => code === "A" || code === "B" || draft[choiceKey(code)] !== undefined,
  );
  const libraryAssets = useMemo(
    () =>
      library.flatMap((pair) =>
        pair.assets.map((asset) => ({ ...asset, pairId: pair.id, pairTitle: pair.title })),
      ),
    [library],
  );
  const selectedLibraryAssetIds = draft.libraryAssetIds ?? [];

  const canSubmit = useMemo(() => {
    const choiceValues = activeChoiceCodes.map((code) => draft[choiceKey(code)]?.trim() ?? "");
    const choiceMedia = activeChoiceCodes.map((code) => draft[mediaKey(code)]);
    const hasAnyChoiceMedia = choiceMedia.some((media) => Boolean(media?.uri || media?.assetId));
    const hasAllChoiceMedia = choiceMedia.every((media) => Boolean(media?.uri || media?.assetId));
    const hasContextMedia = Boolean(draft.mediaContext?.uri || draft.mediaContext?.assetId);
    const hasLibrary = Boolean(draft.libraryPairId || selectedLibraryAssetIds.length);
    return (
      sessionToken &&
      draft.question.trim().length >= 5 &&
      choiceValues.every(Boolean) &&
      new Set(choiceValues.map((value) => value.toLocaleLowerCase("ko"))).size ===
        choiceValues.length &&
      draft.interestCardCode &&
      (!hasAnyChoiceMedia || hasAllChoiceMedia) &&
      !(
        hasLibrary &&
        (hasAnyChoiceMedia ||
          hasContextMedia ||
          (draft.libraryPairId
            ? activeChoiceCodes.length !== 2
            : selectedLibraryAssetIds.length !== activeChoiceCodes.length))
      ) &&
      (!(hasAnyChoiceMedia || hasContextMedia) || mediaAccess?.allowed === true)
    );
  }, [
    activeChoiceCodes,
    draft,
    mediaAccess?.allowed,
    selectedLibraryAssetIds.length,
    sessionToken,
  ]);

  async function persistDraft(next: Draft) {
    setDraft(next);
    await subjectStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  }

  async function chooseMedia(target: MediaTarget) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("사진 접근 권한", "질문 이미지를 고르려면 사진 접근을 허용해 주세요.");
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
        `which-${target.toLowerCase()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`,
      type,
    };
    await persistDraft({
      ...draft,
      libraryPairId: undefined,
      libraryAssetIds: undefined,
      [mediaKey(target)]: media,
    });
  }

  async function uploadDraftMedia(current: Draft, submissionId: string, target: MediaTarget) {
    const key = mediaKey(target);
    const media = current[key];
    if (!media || media.assetId) return current;
    if (!media.uri || !media.name || !media.type) {
      throw new Error(
        `${target === "CONTEXT" ? "설명" : target + " 선택지"} 이미지를 다시 선택해 주세요.`,
      );
    }
    const result = await mobileApi.uploadMemberIssueMedia(sessionToken!, submissionId, {
      uri: media.uri,
      name: media.name,
      type: media.type,
    });
    const next = { ...current, [key]: { ...media, assetId: result.asset.id } };
    await persistDraft(next);
    return next;
  }

  async function submit() {
    if (!sessionToken || !draft.interestCardCode || !canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const hasDirectMedia = Boolean(
        draft.mediaContext || draft.mediaA || draft.mediaB || draft.mediaC || draft.mediaD,
      );
      if (
        !draft.submissionId &&
        (draft.libraryPairId || selectedLibraryAssetIds.length > 0 || !hasDirectMedia)
      ) {
        const result = await mobileApi.createMemberIssue(sessionToken, draft.idempotencyKey, {
          question: draft.question,
          context: draft.context.trim() || null,
          choiceA: draft.choiceA,
          choiceB: draft.choiceB,
          choiceC: draft.choiceC ?? null,
          choiceD: draft.choiceD ?? null,
          libraryPairId: draft.libraryPairId,
          libraryAssetIds: selectedLibraryAssetIds,
          interestCardCode: draft.interestCardCode,
        });
        await subjectStorage.removeItem(DRAFT_KEY);
        setDraft(emptyDraft());
        toast.success("질문을 게시했어요.");
        router.replace("/issues/" + result.issue.id);
        return;
      }
      let prepared = draft;
      if (hasDirectMedia && !prepared.submissionId) {
        const base = await mobileApi.submitMemberIssue(sessionToken, prepared.idempotencyKey, {
          question: prepared.question,
          context: prepared.context.trim() || null,
          choiceA: prepared.choiceA,
          choiceB: prepared.choiceB,
          choiceC: prepared.choiceC ?? null,
          choiceD: prepared.choiceD ?? null,
          contextMediaAssetId: null,
          mediaAssetAId: null,
          mediaAssetBId: null,
          mediaAssetCId: null,
          mediaAssetDId: null,
          interestCardCode: prepared.interestCardCode!,
        });
        prepared = {
          ...prepared,
          submissionId: base.submission.id,
          expectedRevision: base.submission.revision,
          idempotencyKey: randomUUID(),
        };
        await persistDraft(prepared);
      }
      if (hasDirectMedia && prepared.submissionId) {
        const submissionId = prepared.submissionId;
        for (const target of ["CONTEXT", ...activeChoiceCodes] as MediaTarget[]) {
          if (prepared[mediaKey(target)]) {
            prepared = await uploadDraftMedia(prepared, submissionId, target);
          }
        }
      }
      const content = {
        question: prepared.question,
        context: prepared.context.trim() || null,
        choiceA: prepared.choiceA,
        choiceB: prepared.choiceB,
        choiceC: prepared.choiceC ?? null,
        choiceD: prepared.choiceD ?? null,
        contextMediaAssetId: prepared.mediaContext?.assetId ?? null,
        mediaAssetAId: prepared.mediaA?.assetId ?? null,
        mediaAssetBId: prepared.mediaB?.assetId ?? null,
        mediaAssetCId: prepared.mediaC?.assetId ?? null,
        mediaAssetDId: prepared.mediaD?.assetId ?? null,
        interestCardCode: prepared.interestCardCode!,
      };
      const result =
        prepared.submissionId && prepared.expectedRevision
          ? await mobileApi.resubmitMemberIssue(
              sessionToken,
              prepared.submissionId,
              prepared.idempotencyKey,
              { ...content, expectedRevision: prepared.expectedRevision },
            )
          : await mobileApi.submitMemberIssue(sessionToken, prepared.idempotencyKey, content);
      await subjectStorage.removeItem(DRAFT_KEY);
      setDraft(emptyDraft());
      setSubmissions((current) => [
        result.submission,
        ...current.filter((item) => item.id !== result.submission.id),
      ]);
      if (prepared.libraryPairId || !hasDirectMedia) {
        await transition(
          result.submission,
          prepared.libraryPairId ? "LIBRARY" : "TEXT_ONLY",
          prepared.libraryPairId,
        );
        return;
      }
      toast.success(
        prepared.submissionId
          ? `v${result.submission.revision} 수정본을 다시 제출했어요.`
          : "질문을 운영 검수로 제출했어요.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "질문을 제출하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(
    submission: MemberIssueSubmission,
    action: "TEXT_ONLY" | "LIBRARY" | "CANCEL" | "CHECK",
    pairId?: string,
  ) {
    if (!sessionToken) return;
    setSubmitting(true);
    try {
      const result = await mobileApi.actOnMemberSubmission(
        sessionToken,
        submission,
        action,
        pairId,
      );
      setSubmissions((current) =>
        current.map((item) => (item.id === submission.id ? result.submission : item)),
      );
      setLibraryTarget(null);
      toast.success(
        action === "CANCEL"
          ? "제출을 취소했어요."
          : result.submission.publishedIssueId
            ? "질문이 게시되었어요."
            : "최신 상태를 확인했어요.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "처리하지 못했어요.");
      await mobileApi
        .loadMemberIssueSubmissions(sessionToken)
        .then((result) => setSubmissions(result.items))
        .catch(() => {});
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
      choiceC: submission.choiceC ?? undefined,
      choiceD: submission.choiceD ?? undefined,
      mediaContext: submission.contextMediaAssetId
        ? { assetId: submission.contextMediaAssetId }
        : undefined,
      mediaA: submission.mediaAssetAId ? { assetId: submission.mediaAssetAId } : undefined,
      mediaB: submission.mediaAssetBId ? { assetId: submission.mediaAssetBId } : undefined,
      mediaC: submission.mediaAssetCId ? { assetId: submission.mediaAssetCId } : undefined,
      mediaD: submission.mediaAssetDId ? { assetId: submission.mediaAssetDId } : undefined,
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
                : "2~4개 중 하나를 고르는 질문을 만들어 보세요."}
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
            {activeChoiceCodes.map((code) => (
              <Field
                compact
                key={code}
                label={`${code} 선택지`}
                maxLength={50}
                onChangeText={(value) =>
                  setDraft((current) => ({ ...current, [choiceKey(code)]: value }))
                }
                placeholder={`${code} 선택지를 적어 주세요`}
                value={draft[choiceKey(code)] ?? ""}
              />
            ))}
          </View>
          <View style={styles.choiceActions}>
            {activeChoiceCodes.length < 4 ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  const code = CHOICE_CODES[activeChoiceCodes.length]!;
                  setDraft((current) => ({
                    ...current,
                    [choiceKey(code)]: "",
                    libraryPairId: undefined,
                  }));
                }}
              >
                <Text style={styles.secondaryButtonText}>+ 선택지 추가</Text>
              </Pressable>
            ) : null}
            {activeChoiceCodes.length > 2 ? (
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  const code = activeChoiceCodes.at(-1)!;
                  const next = { ...draft };
                  delete next[choiceKey(code)];
                  delete next[mediaKey(code)];
                  next.libraryPairId = undefined;
                  next.libraryAssetIds = selectedLibraryAssetIds.slice(
                    0,
                    activeChoiceCodes.length - 1,
                  );
                  setDraft(next);
                }}
              >
                <Text style={styles.secondaryButtonText}>마지막 선택지 삭제</Text>
              </Pressable>
            ) : null}
          </View>

          {mediaAccess?.allowed ? (
            <>
              <ChoiceMedia
                wide
                label="짧은 설명 이미지 (선택)"
                media={draft.mediaContext}
                onPress={() => void chooseMedia("CONTEXT")}
              />
              <View style={styles.mediaRow}>
                {activeChoiceCodes.map((code) => (
                  <ChoiceMedia
                    key={code}
                    label={`${code} 이미지 (선택)`}
                    media={draft[mediaKey(code)]}
                    onPress={() => void chooseMedia(code)}
                  />
                ))}
              </View>
              <Text style={styles.help}>
                선택지 이미지를 넣을 때는 현재 선택지 모두에 첨부해 주세요.
              </Text>
            </>
          ) : null}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>이미지 방식</Text>
            {mediaAccess &&
            mediaAccess.mode !== "OFF" &&
            mediaAccess.reasons.includes("CONSENT_REQUIRED") ? (
              <View style={styles.consentCard}>
                <Text style={styles.help}>
                  기존 회원은 이미지 직접 업로드 전에 콘텐츠 권리·자동 안전 검사 약관을 한 번 확인해
                  주세요.
                </Text>
                <Pressable
                  onPress={() => {
                    void mobileApi
                      .acceptIssueMediaConsent(sessionToken)
                      .then(({ access }) => {
                        setMediaAccess(access);
                        toast.success("이미지 업로드 약관에 동의했어요.");
                      })
                      .catch((error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : "이미지 업로드 약관 동의를 저장하지 못했습니다.",
                        ),
                      );
                  }}
                  style={styles.consentButton}
                >
                  <Text style={styles.consentButtonText}>확인하고 동의</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.mediaModeRow}>
              <Pressable
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    libraryPairId: undefined,
                    libraryAssetIds: undefined,
                    mediaA: undefined,
                    mediaB: undefined,
                    mediaC: undefined,
                    mediaD: undefined,
                    mediaContext: undefined,
                  }))
                }
                style={[
                  styles.chip,
                  !draft.libraryPairId &&
                    selectedLibraryAssetIds.length === 0 &&
                    styles.chipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    !draft.libraryPairId &&
                      selectedLibraryAssetIds.length === 0 &&
                      styles.chipTextSelected,
                  ]}
                >
                  {mediaAccess?.allowed ? "텍스트 / 직접 업로드" : "텍스트만"}
                </Text>
              </Pressable>
              <Pressable
                disabled={libraryAssets.length === 0}
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    libraryPairId: undefined,
                    libraryAssetIds: current.libraryAssetIds ?? [],
                    mediaA: undefined,
                    mediaB: undefined,
                    mediaC: undefined,
                    mediaD: undefined,
                    mediaContext: undefined,
                  }))
                }
                style={[
                  styles.chip,
                  libraryAssets.length === 0 && styles.buttonDisabled,
                  selectedLibraryAssetIds.length > 0 && styles.chipSelected,
                ]}
              >
                <Text style={styles.chipText}>승인 이미지 Library</Text>
              </Pressable>
            </View>
            {selectedLibraryAssetIds.length > 0 ? (
              <Text style={styles.librarySelectionCount}>
                선택한 순서대로 A/B/C/D · {selectedLibraryAssetIds.length}/
                {activeChoiceCodes.length}
              </Text>
            ) : null}
            {libraryAssets.length ? (
              <ScrollView
                horizontal
                contentContainerStyle={styles.libraryList}
                showsHorizontalScrollIndicator={false}
              >
                {libraryAssets.map((asset) => {
                  const selectedIndex = selectedLibraryAssetIds.indexOf(asset.id);
                  const assignment = selectedIndex >= 0 ? activeChoiceCodes[selectedIndex] : null;
                  return (
                    <Pressable
                      accessibilityLabel={`${asset.pairTitle} · ${asset.altText}`}
                      accessibilityState={{ selected: selectedIndex >= 0 }}
                      key={asset.id}
                      onPress={() => {
                        if (selectedIndex >= 0) {
                          setDraft((current) => ({
                            ...current,
                            libraryPairId: undefined,
                            libraryAssetIds: selectedLibraryAssetIds.filter(
                              (id) => id !== asset.id,
                            ),
                          }));
                          return;
                        }
                        if (selectedLibraryAssetIds.length >= activeChoiceCodes.length) {
                          toast.info("선택지 수만큼 골랐어요. 하나를 해제한 뒤 선택해 주세요.");
                          return;
                        }
                        setDraft((current) => ({
                          ...current,
                          libraryPairId: undefined,
                          libraryAssetIds: [...selectedLibraryAssetIds, asset.id],
                          mediaA: undefined,
                          mediaB: undefined,
                          mediaC: undefined,
                          mediaD: undefined,
                          mediaContext: undefined,
                        }));
                      }}
                      style={[styles.libraryCard, assignment && libraryAssignmentStyle[assignment]]}
                    >
                      <View style={styles.libraryImages}>
                        <Image source={{ uri: asset.url }} style={styles.libraryImage} />
                        {assignment ? (
                          <View style={styles.libraryAssignmentBadge}>
                            <Text style={styles.libraryAssignmentText}>{assignment}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text numberOfLines={1} style={styles.libraryTitle}>
                        {asset.pairTitle}
                      </Text>
                      <Text numberOfLines={1} style={styles.libraryDescription}>
                        {asset.altText}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={styles.help}>현재 사용할 수 있는 승인 이미지가 없습니다.</Text>
            )}
          </View>

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
                    <Text style={styles.submissionStatus}>
                      {submission.publishedIssueId
                        ? "게시 완료"
                        : submission.publicationState === "QUARANTINED"
                          ? "공개 보류"
                          : statusLabel[submission.status]}
                    </Text>
                    <Text style={styles.submissionRevision}>v{submission.revision}</Text>
                  </View>
                  <Text style={styles.submissionQuestion}>{submission.question}</Text>
                  {submission.reviewNote ? (
                    <Text style={styles.reviewNote}>{submission.reviewNote}</Text>
                  ) : null}
                  {!submission.publishedIssueId &&
                  ["NEEDS_CHANGES", "PENDING"].includes(submission.status) ? (
                    <View>
                      <Pressable
                        disabled={submitting}
                        onPress={() => editSubmission(submission)}
                        style={styles.revisionButton}
                      >
                        <Text style={styles.revisionButtonText}>수정해서 다시 제출</Text>
                      </Pressable>
                      {(["TEXT_ONLY", "CHECK", "CANCEL"] as const).map((action) => (
                        <Pressable
                          key={action}
                          disabled={submitting}
                          style={styles.revisionButton}
                          onPress={() => {
                            if (action === "CHECK") {
                              void transition(submission, action);
                              return;
                            }
                            Alert.alert(
                              action === "CANCEL"
                                ? "제출을 취소할까요?"
                                : "이미지 없이 바로 게시할까요?",
                              "",
                              [
                                { text: "돌아가기", style: "cancel" },
                                {
                                  text: "확인",
                                  onPress: () => void transition(submission, action),
                                },
                              ],
                            );
                          }}
                        >
                          <Text style={styles.revisionButtonText}>
                            {action === "TEXT_ONLY"
                              ? "이미지 없이 게시"
                              : action === "CHECK"
                                ? "게시 상태 확인"
                                : "제출 취소"}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        disabled={submitting}
                        style={styles.revisionButton}
                        onPress={() =>
                          setLibraryTarget(libraryTarget === submission.id ? null : submission.id)
                        }
                      >
                        <Text style={styles.revisionButtonText}>Library로 교체</Text>
                      </Pressable>
                      {libraryTarget === submission.id ? (
                        library.length ? (
                          library.map((pair) => (
                            <Pressable
                              key={pair.id}
                              disabled={submitting}
                              style={styles.revisionButton}
                              onPress={() =>
                                Alert.alert("Library 이미지로 바로 게시할까요?", pair.title, [
                                  { text: "취소", style: "cancel" },
                                  {
                                    text: "게시",
                                    onPress: () => void transition(submission, "LIBRARY", pair.id),
                                  },
                                ])
                              }
                            >
                              <Text style={styles.revisionButtonText}>{pair.title}</Text>
                            </Pressable>
                          ))
                        ) : (
                          <Text>사용 가능한 Library 이미지가 없어요.</Text>
                        )
                      ) : null}
                    </View>
                  ) : null}
                  {submission.publishedIssueId ? (
                    <Pressable
                      style={styles.revisionButton}
                      onPress={() => router.push(`/issues/${submission.publishedIssueId}`)}
                    >
                      <Text style={styles.revisionButtonText}>게시된 질문 보기</Text>
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
  wide = false,
}: {
  label: string;
  media?: DraftMedia;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.mediaPicker, wide && styles.mediaPickerWide]}>
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
  fieldCompact: { flexBasis: "47%", flexGrow: 1 },
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
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  choiceActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  secondaryButtonText: { color: colors.textSecondary, fontSize: 12, fontWeight: "900" },
  mediaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  mediaModeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  consentCard: {
    backgroundColor: colors.cyanSoft,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  consentButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  consentButtonText: { color: "#062A31", fontSize: 12, fontWeight: "900" },
  mediaPicker: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderStyle: "dashed",
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 5,
    justifyContent: "center",
    minHeight: 104,
    overflow: "hidden",
    padding: 10,
  },
  mediaPickerWide: { flexBasis: "100%" },
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
  libraryImages: {
    borderRadius: 9,
    flexDirection: "row",
    height: 92,
    overflow: "hidden",
  },
  libraryImage: { flex: 1, height: 92 },
  libraryAssignmentBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderColor: colors.text,
    borderRadius: 999,
    borderWidth: 2,
    height: 30,
    justifyContent: "center",
    left: 7,
    position: "absolute",
    top: 7,
    width: 30,
  },
  libraryAssignmentText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  libraryDescription: { color: colors.textTertiary, fontSize: 11 },
  librarySelectionCount: { color: colors.cyanStrong, fontSize: 12, fontWeight: "900" },
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
