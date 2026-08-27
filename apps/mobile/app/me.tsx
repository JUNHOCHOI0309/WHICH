import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  MemberPointView,
  MemberPrivateProfile,
  MemberPrivateVote,
  MemberSessionView,
} from "@/contracts";
import { MemberPointDrawer } from "@/features/points/member-point-drawer";
import { clearRememberedMemberVotes, rememberMemberVote } from "@/lib/member-vote-cache";
import { MobileApiError } from "@/lib/mobile-api";
import { memberSessions, mobileApi } from "@/lib/runtime";
import { colors } from "@/theme";

type Screen = "loading" | "guest" | "ready" | "error";
type Tab = "profile" | "votes";

const providerLabels = {
  EMAIL: "이메일",
  GOOGLE: "Google",
  X: "X",
  NAVER: "Naver",
  KAKAO: "Kakao",
  DEVELOPMENT: "개발 계정",
} as const;

function dateLabel(value: string, includeTime = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: includeTime ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: includeTime ? "numeric" : undefined,
    minute: includeTime ? "2-digit" : undefined,
  }).format(new Date(value));
}

function apiMessage(error: unknown, fallback: string) {
  if (!(error instanceof MobileApiError)) return fallback;
  if (error.code === "HANDLE_TAKEN") return "이미 사용 중인 Handle이에요.";
  if (error.code === "HANDLE_RESERVED") return "WHICH에서 예약한 Handle이에요.";
  if (error.code === "HANDLE_INVALID") return "영문, 숫자, 밑줄로 3~30자를 입력해 주세요.";
  if (error.code === "CREDENTIAL_INVALID") return "현재 비밀번호가 올바르지 않습니다.";
  if (error.code === "CREDENTIAL_REQUIRED") {
    return "탈퇴 전에 이메일·비밀번호 로그인을 먼저 연결해 주세요.";
  }
  return error.message || fallback;
}

export default function MeScreen() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [tab, setTab] = useState<Tab>("profile");
  const [session, setSession] = useState<MemberSessionView | null>(null);
  const [profile, setProfile] = useState<MemberPrivateProfile | null>(null);
  const [points, setPoints] = useState<MemberPointView | null>(null);
  const [pointDrawerOpen, setPointDrawerOpen] = useState(false);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsLoadingMore, setPointsLoadingMore] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [history, setHistory] = useState<MemberPrivateVote[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyPending, setHistoryPending] = useState(false);
  const [avatarPending, setAvatarPending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void reloadKey;
      let active = true;
      setScreen("loading");
      void memberSessions
        .restore()
        .then(async (restored) => {
          if (!active) return;
          if (!restored) {
            clearRememberedMemberVotes();
            setSession(null);
            setProfile(null);
            setPoints(null);
            setPointsError(null);
            setScreen("guest");
            return;
          }
          const nextProfile = await mobileApi.loadMemberProfile(restored.token, { limit: 10 });
          if (!active) return;
          setSession(restored);
          setProfile(nextProfile);
          setHistory(nextProfile.votes.items);
          setHistoryCursor(nextProfile.votes.nextCursor);
          setScreen("ready");
          setPointsLoading(true);
          setPointsError(null);
          void mobileApi
            .loadMemberPoints(restored.token, { limit: 10 })
            .then((nextPoints) => {
              if (active) setPoints(nextPoints);
            })
            .catch(() => {
              if (active)
                setPointsError(
                  "포인트 내역만 불러오지 못했어요. 다른 기능은 계속 사용할 수 있어요.",
                );
            })
            .finally(() => {
              if (active) setPointsLoading(false);
            });
        })
        .catch(() => {
          if (active) setScreen("error");
        });
      return () => {
        active = false;
      };
    }, [reloadKey]),
  );

  async function loadMoreVotes() {
    if (!session || !historyCursor || historyPending) return;
    setHistoryPending(true);
    try {
      const next = await mobileApi.loadMemberProfile(session.token, {
        limit: 20,
        cursor: historyCursor,
      });
      setHistory((current) => [...current, ...next.votes.items]);
      setHistoryCursor(next.votes.nextCursor);
    } catch (error) {
      Alert.alert("투표 기록", apiMessage(error, "다음 기록을 불러오지 못했습니다."));
    } finally {
      setHistoryPending(false);
    }
  }

  async function reloadPoints() {
    if (!session || pointsLoading) return;
    setPointsLoading(true);
    setPointsError(null);
    try {
      setPoints(await mobileApi.loadMemberPoints(session.token, { limit: 10 }));
    } catch {
      setPointsError("포인트 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPointsLoading(false);
    }
  }

  async function loadMorePoints() {
    const cursor = points?.ledger.nextCursor;
    if (!session || !points || !cursor || pointsLoadingMore) return;
    setPointsLoadingMore(true);
    try {
      const next = await mobileApi.loadMemberPoints(session.token, { limit: 20, cursor });
      setPoints({
        account: next.account,
        ledger: {
          items: [...points.ledger.items, ...next.ledger.items],
          nextCursor: next.ledger.nextCursor,
        },
      });
    } catch {
      setPointsError("이전 포인트 내역을 불러오지 못했어요.");
    } finally {
      setPointsLoadingMore(false);
    }
  }

  async function chooseAvatar() {
    if (!session || !profile || avatarPending) return;
    setAvatarPending(true);
    let phase: "permission" | "picker" | "upload" = "permission";
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("사진 접근 권한", "프로필 이미지를 선택하려면 사진 접근을 허용해 주세요.");
        return;
      }
      phase = "picker";
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert("이미지가 너무 커요", "5MB 이하 JPG 또는 PNG 이미지를 선택해 주세요.");
        return;
      }
      phase = "upload";
      const response = await mobileApi.uploadMemberAvatar(session.token, {
        uri: asset.uri,
        name: asset.fileName ?? `which-avatar.${asset.mimeType === "image/png" ? "png" : "jpg"}`,
        type: asset.mimeType === "image/png" ? "image/png" : "image/jpeg",
      });
      setProfile((current) =>
        current ? { ...current, member: { ...current.member, ...response.member } } : current,
      );
      Alert.alert("프로필 이미지", "프로필 이미지를 변경했어요.");
    } catch (error) {
      if (__DEV__) console.error("Profile avatar update failed", { error, phase });
      const fallback =
        phase === "upload"
          ? "이미지는 선택했지만 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : "사진 보관함에서 이미지를 선택하지 못했습니다.";
      Alert.alert("프로필 이미지", apiMessage(error, fallback));
    } finally {
      setAvatarPending(false);
    }
  }

  if (screen === "loading") return <LoadingState />;
  if (screen === "guest") return <GuestState />;
  if (screen === "error" || !session || !profile) {
    return <ErrorState onRetry={() => setReloadKey((value) => value + 1)} />;
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Brand />
        <Text style={styles.headerLabel}>내 정보</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ProfileSummary
          avatarPending={avatarPending}
          onAvatarPress={() => void chooseAvatar()}
          profile={profile}
        />
        <View accessibilityRole="tablist" style={styles.tabs}>
          <TabButton active={tab === "profile"} label="프로필" onPress={() => setTab("profile")} />
          <TabButton active={tab === "votes"} label="투표 기록" onPress={() => setTab("votes")} />
        </View>
        {tab === "profile" ? (
          <>
            <ProfileSettings
              profile={profile}
              session={session}
              onUpdated={(next) =>
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        member: { ...current.member, displayName: next.displayName },
                        publicProfile: {
                          handle: next.handle,
                          bio: next.bio,
                          visibility: next.visibility,
                          publicUrl: next.publicUrl,
                        },
                      }
                    : current,
                )
              }
            />
            <ConnectedLogins profile={profile} />
            <AccountActions session={session} />
          </>
        ) : (
          <VoteHistory
            hasMore={Boolean(historyCursor)}
            items={history}
            loading={historyPending}
            onLoadMore={() => void loadMoreVotes()}
          />
        )}
      </ScrollView>
      <Pressable
        accessibilityHint="오른쪽에서 W Point 적립 내역을 엽니다."
        accessibilityLabel="W Point 열기"
        accessibilityRole="button"
        onPress={() => setPointDrawerOpen(true)}
        style={styles.pointDrawerHandle}
      >
        <Text style={styles.pointDrawerHandleText}>
          W{points ? ` ${points.account.balance}P` : " POINT"}
        </Text>
      </Pressable>
      <MemberPointDrawer
        error={pointsError}
        loading={pointsLoading}
        loadingMore={pointsLoadingMore}
        onClose={() => setPointDrawerOpen(false)}
        onLoadMore={() => void loadMorePoints()}
        onRetry={() => void reloadPoints()}
        points={points}
        visible={pointDrawerOpen}
      />
      <BottomNav />
    </SafeAreaView>
  );
}

function Brand() {
  return (
    <Text style={styles.brand}>
      <Text style={styles.brandW}>W</Text>HICH
    </Text>
  );
}

function LoadingState() {
  return (
    <SafeAreaView style={styles.centered}>
      <ActivityIndicator color={colors.cyanStrong} size="large" />
      <Text style={styles.centeredCopy}>내 정보를 확인하고 있어요.</Text>
    </SafeAreaView>
  );
}

function GuestState() {
  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Brand />
        <Text style={styles.headerLabel}>Guest</Text>
      </View>
      <View style={styles.guestCard}>
        <Text style={styles.eyebrow}>PRIVATE ME</Text>
        <Text style={styles.guestTitle}>로그인하면 내 선택이 이어져요.</Text>
        <Text style={styles.description}>
          Guest 투표는 로그인 뒤 계정에 안전하게 연결됩니다. 전체 기록과 프로필은 로그인한 본인만
          확인할 수 있어요. 로그인하면 투표·공유로 모은 W Point와 누적 배지도 확인할 수 있어요.
        </Text>
        <Pressable
          onPress={() => router.push("/login?returnTo=%2Fme")}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>로그인 또는 빠른 회원가입</Text>
        </Pressable>
      </View>
      <BottomNav />
    </SafeAreaView>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <SafeAreaView style={styles.centered}>
      <Text style={styles.errorTitle}>내 정보를 불러오지 못했어요.</Text>
      <Text style={styles.centeredCopy}>연결 상태를 확인한 뒤 다시 시도해 주세요.</Text>
      <Pressable onPress={onRetry} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>다시 불러오기</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ProfileSummary({
  avatarPending,
  onAvatarPress,
  profile,
}: {
  avatarPending: boolean;
  onAvatarPress: () => void;
  profile: MemberPrivateProfile;
}) {
  return (
    <View style={styles.profileCard}>
      <Pressable
        accessibilityHint="사진 보관함에서 새 프로필 이미지를 선택합니다."
        accessibilityLabel="프로필 이미지 변경"
        accessibilityRole="button"
        disabled={avatarPending}
        hitSlop={10}
        onPress={onAvatarPress}
        style={({ pressed }) => [styles.avatarButton, pressed && styles.avatarButtonPressed]}
      >
        {profile.member.avatar.kind === "IMAGE" ? (
          <Image source={{ uri: profile.member.avatar.url }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatarInitials}>
            <Text style={styles.avatarText}>{profile.member.avatar.initials}</Text>
          </View>
        )}
        <View style={styles.avatarEditBadge}>
          <Text style={styles.avatarEditBadgeText}>{avatarPending ? "…" : "변경"}</Text>
        </View>
      </Pressable>
      <Text style={styles.eyebrow}>PRIVATE MEMBER PROFILE</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {profile.member.displayName}님의 선택
      </Text>
      <Text style={styles.description}>{dateLabel(profile.member.joinedAt)}부터 참여했어요.</Text>
      <View style={styles.participation}>
        <Text style={styles.participationValue}>{profile.member.participationCount}</Text>
        <Text style={styles.participationLabel}>참여한 질문</Text>
      </View>
    </View>
  );
}

function ProfileSettings({
  profile,
  session,
  onUpdated,
}: {
  profile: MemberPrivateProfile;
  session: MemberSessionView;
  onUpdated: (profile: Awaited<ReturnType<typeof mobileApi.updateMemberProfile>>) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.member.displayName);
  const [handle, setHandle] = useState(profile.publicProfile?.handle ?? "");
  const [bio, setBio] = useState(profile.publicProfile?.bio ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">(
    profile.publicProfile?.visibility ?? "PRIVATE",
  );
  const [saving, setSaving] = useState(false);
  const valid = displayName.trim().length > 0 && /^[A-Za-z0-9_]{3,30}$/.test(handle);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const next = await mobileApi.updateMemberProfile(session.token, {
        displayName: displayName.trim(),
        handle,
        bio: bio.trim() || null,
        visibility,
      });
      setDisplayName(next.displayName);
      onUpdated(next);
      Alert.alert("프로필", "프로필을 저장했어요.");
    } catch (error) {
      Alert.alert("프로필", apiMessage(error, "프로필을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.eyebrow}>PUBLIC CREATOR PROFILE</Text>
      <Text style={styles.sectionTitle}>질문을 만드는 나를 소개해요.</Text>
      <Text style={styles.label}>닉네임</Text>
      <TextInput
        maxLength={80}
        onChangeText={setDisplayName}
        placeholder="WHICH 회원"
        style={styles.input}
        value={displayName}
      />
      <Text style={styles.label}>Handle</Text>
      <View style={styles.handleInput}>
        <Text style={styles.handlePrefix}>@</Text>
        <TextInput
          autoCapitalize="none"
          maxLength={30}
          onChangeText={setHandle}
          placeholder="question_maker"
          style={styles.handleTextInput}
          value={handle}
        />
      </View>
      <Text style={styles.fieldHint}>영문·숫자·밑줄 3~30자</Text>
      <Text style={styles.label}>짧은 소개</Text>
      <TextInput
        maxLength={160}
        multiline
        onChangeText={setBio}
        placeholder="어떤 질문을 만들고 싶은지 소개해 주세요."
        style={[styles.input, styles.bioInput]}
        textAlignVertical="top"
        value={bio}
      />
      <Text style={styles.fieldHint}>{bio.length}/160</Text>
      <Text style={styles.label}>공개 범위</Text>
      <View style={styles.visibilityRow}>
        {(["PUBLIC", "PRIVATE"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setVisibility(value)}
            style={[styles.visibilityChoice, visibility === value && styles.visibilityChoiceActive]}
          >
            <Text style={styles.visibilityText}>{value === "PUBLIC" ? "공개" : "비공개"}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        disabled={!valid || saving}
        onPress={() => void save()}
        style={[styles.primaryButton, (!valid || saving) && styles.buttonDisabled]}
      >
        <Text style={styles.primaryButtonText}>{saving ? "저장 중…" : "프로필 저장"}</Text>
      </Pressable>
    </View>
  );
}

function ConnectedLogins({ profile }: { profile: MemberPrivateProfile }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.eyebrow}>CONNECTED LOGIN</Text>
      <Text style={styles.sectionTitle}>연결된 로그인</Text>
      <View style={styles.identityList}>
        {profile.identities.map((identity) => (
          <View key={identity.provider} style={styles.identityChip}>
            <Text style={styles.identityText}>{providerLabels[identity.provider]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function VoteHistory({
  items,
  hasMore,
  loading,
  onLoadMore,
}: {
  items: MemberPrivateVote[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.eyebrow}>VOTE HISTORY</Text>
      <Text style={styles.sectionTitle}>전체 투표 기록</Text>
      {items.length ? (
        items.map((vote) => (
          <Pressable
            key={vote.voteId}
            onPress={() => {
              rememberMemberVote(vote);
              router.push({
                pathname: "/issues/[issueId]",
                params: { issueId: vote.issueId },
              });
            }}
            style={styles.voteItem}
          >
            <View style={styles.voteChoice}>
              <Text style={styles.voteChoiceText}>{vote.choice}</Text>
            </View>
            <View style={styles.voteCopy}>
              <Text style={styles.voteQuestion}>{vote.question}</Text>
              <Text style={styles.voteMeta}>
                {vote.choiceLabel} · {dateLabel(vote.acceptedAt)}
              </Text>
            </View>
            <Text style={styles.voteArrow}>→</Text>
          </Pressable>
        ))
      ) : (
        <Text style={styles.description}>아직 계정에 연결된 투표 기록이 없어요.</Text>
      )}
      {hasMore ? (
        <Pressable disabled={loading} onPress={onLoadMore} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>
            {loading ? "불러오는 중…" : "이전 기록 더 보기"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AccountActions({ session }: { session: MemberSessionView }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const canDelete = password.length > 0 && confirmation === "탈퇴합니다";

  async function removeAccount() {
    if (!canDelete || pending) return;
    setPending(true);
    try {
      await mobileApi.deleteMemberAccount(session.token, password);
      await memberSessions.logout();
      clearRememberedMemberVotes();
      Alert.alert("회원 탈퇴", "모든 세션과 개인정보를 삭제하고 활동 기록을 익명화했습니다.");
      router.replace("/");
    } catch (error) {
      Alert.alert("회원 탈퇴", apiMessage(error, "회원 탈퇴를 처리하지 못했습니다."));
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.eyebrow}>ACCOUNT</Text>
      <Text style={styles.sectionTitle}>계정 관리</Text>
      <Text style={styles.description}>
        로그아웃하면 이 기기의 세션만 종료됩니다. 탈퇴하면 모든 세션과 개인정보·로그인 수단을
        삭제하고 기존 활동은 탈퇴한 사용자로 익명화합니다.
      </Text>
      <Pressable
        onPress={() =>
          void memberSessions.logout().then(() => {
            clearRememberedMemberVotes();
            router.replace("/login");
          })
        }
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>로그아웃</Text>
      </Pressable>
      {!deleteOpen ? (
        <Pressable onPress={() => setDeleteOpen(true)} style={styles.deleteButton}>
          <Text style={styles.dangerText}>회원 탈퇴</Text>
        </Pressable>
      ) : (
        <View style={styles.deleteForm}>
          <Text style={styles.dangerCopy}>
            되돌릴 수 없습니다. 이메일 비밀번호로 본인을 확인해 주세요.
          </Text>
          <TextInput
            onChangeText={setPassword}
            placeholder="현재 비밀번호"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <TextInput
            onChangeText={setConfirmation}
            placeholder="탈퇴합니다"
            style={styles.input}
            value={confirmation}
          />
          <View style={styles.rowActions}>
            <Pressable onPress={() => setDeleteOpen(false)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>취소</Text>
            </Pressable>
            <Pressable
              disabled={!canDelete || pending}
              onPress={() => void removeAccount()}
              style={[styles.deleteButton, (!canDelete || pending) && styles.buttonDisabled]}
            >
              <Text style={styles.dangerText}>{pending ? "처리 중…" : "회원 탈퇴 확정"}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function BottomNav() {
  return (
    <View style={styles.bottomNav}>
      <Pressable onPress={() => router.replace("/")} style={styles.bottomNavItem}>
        <Text style={styles.bottomNavIcon}>⌂</Text>
        <Text style={styles.bottomNavText}>홈</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/interests")} style={styles.bottomNavItem}>
        <Text style={styles.bottomNavIcon}>#</Text>
        <Text style={styles.bottomNavText}>관심사</Text>
      </Pressable>
      <View style={[styles.bottomNavItem, styles.bottomNavItemActive]}>
        <Text style={styles.bottomNavIconActive}>◎</Text>
        <Text style={styles.bottomNavTextActive}>내 기록</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.bg, flex: 1 },
  centered: {
    alignItems: "center",
    backgroundColor: colors.bg,
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  centeredCopy: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  errorTitle: { color: colors.text, fontSize: 21, fontWeight: "900", textAlign: "center" },
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
  content: { gap: 16, padding: 18, paddingBottom: 28 },
  guestCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    margin: 18,
    padding: 24,
  },
  guestTitle: { color: colors.text, fontSize: 25, fontWeight: "900", lineHeight: 34 },
  profileCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  avatarImage: { borderRadius: 42, height: 84, width: 84 },
  avatarButton: { borderRadius: 42, position: "relative" },
  avatarButtonPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  avatarEditBadge: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
    bottom: 0,
    height: 25,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
  },
  avatarEditBadgeText: { color: colors.surface, fontSize: 10, fontWeight: "900" },
  avatarInitials: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    borderColor: colors.cyan,
    borderRadius: 42,
    borderWidth: 1,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  avatarText: { color: colors.text, fontSize: 23, fontWeight: "900" },
  eyebrow: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900", letterSpacing: 1.3 },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "900",
    lineHeight: 32,
    textAlign: "center",
  },
  description: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  participation: {
    alignItems: "center",
    backgroundColor: colors.cyanSoft,
    borderRadius: 16,
    minWidth: 110,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  participationValue: { color: colors.cyanStrong, fontSize: 24, fontWeight: "900" },
  participationLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  tabs: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    padding: 5,
  },
  tab: { alignItems: "center", borderRadius: 14, flex: 1, minHeight: 46, justifyContent: "center" },
  tabActive: { backgroundColor: colors.cyanSoft },
  tabText: { color: colors.textSecondary, fontSize: 14, fontWeight: "800" },
  tabTextActive: { color: colors.cyanStrong },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 13,
    padding: 20,
  },
  sectionHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 4 },
  label: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 4 },
  input: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  bioInput: { minHeight: 110, paddingTop: 14 },
  handleInput: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 14,
  },
  handlePrefix: { color: colors.cyanStrong, fontSize: 17, fontWeight: "900" },
  handleTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 8,
  },
  fieldHint: { color: colors.textTertiary, fontSize: 11 },
  visibilityRow: { flexDirection: "row", gap: 8 },
  visibilityChoice: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  visibilityChoiceActive: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  visibilityText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: "#062A31", fontSize: 14, fontWeight: "900", textAlign: "center" },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  deleteButton: {
    alignItems: "center",
    borderColor: colors.danger,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonDisabled: { opacity: 0.45 },
  dangerText: { color: colors.danger, fontSize: 13, fontWeight: "900" },
  dangerCopy: { color: colors.danger, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  rowActions: { flexDirection: "row", gap: 8 },
  deleteForm: { gap: 10 },
  pointDrawerHandle: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.cyan,
    borderBottomLeftRadius: 16,
    borderTopLeftRadius: 16,
    borderWidth: 1,
    elevation: 6,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: 10,
    position: "absolute",
    right: 0,
    top: 128,
    zIndex: 12,
  },
  pointDrawerHandleText: { color: colors.cyanStrong, fontSize: 11, fontWeight: "900" },
  identityList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  identityChip: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  identityText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  voteItem: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
  },
  voteChoice: {
    alignItems: "center",
    borderColor: colors.cyan,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  voteChoiceText: { color: colors.cyanStrong, fontSize: 14, fontWeight: "900" },
  voteCopy: { flex: 1, gap: 4 },
  voteQuestion: { color: colors.text, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  voteMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  voteArrow: { color: colors.cyanStrong, fontSize: 20, fontWeight: "900" },
  bottomNav: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    marginTop: "auto",
  },
  bottomNavItem: { alignItems: "center", flex: 1, gap: 2, justifyContent: "center", minHeight: 62 },
  bottomNavItemActive: { backgroundColor: colors.cyanSoft },
  bottomNavIcon: { color: colors.textTertiary, fontSize: 19 },
  bottomNavIconActive: { color: colors.cyanStrong, fontSize: 19 },
  bottomNavText: { color: colors.textSecondary, fontSize: 10, fontWeight: "700" },
  bottomNavTextActive: { color: colors.text, fontSize: 10, fontWeight: "900" },
});
