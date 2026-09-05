"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import { WhichShell } from "@/components/layout/which-shell";
import type {
  ChoiceCode,
  InterestCardCode,
  MemberIssueSubmission,
  MemberPointShopView,
  MemberPrivateProfile,
  MemberPrivateVote,
} from "@/lib/contracts";
import { loadInterestProfile } from "@/features/interests/client";
import { logoutMemberSession, MEMBER_LOGOUT_ERROR } from "@/lib/member-session";
import { avatarFrameStyle, equippedShopItem, profileAccentStyle } from "@/lib/point-shop-cosmetics";

import styles from "./member-profile-experience.module.css";
import { MemberProfileTabs } from "./member-profile-tabs";
import { MemberPointPanel } from "./member-point-panel";
import { MemberPublicProfileSettings } from "./member-public-profile-settings";
import { MemberAvatarSettings } from "./member-avatar-settings";

type Screen = "loading" | "guest" | "ready" | "error";

type AccountDeletionError = { code?: string; message?: string };

const IDENTITY_LABELS = {
  EMAIL: "이메일",
  GOOGLE: "Google",
  X: "X",
  NAVER: "Naver",
  KAKAO: "Kakao",
  TIKTOK: "TikTok",
} as const;

const INTEREST_LABELS: Record<InterestCardCode, string> = {
  DAILY_LIFE: "생활",
  FOOD: "음식",
  TRAVEL: "여행",
  RELATIONSHIP: "연애·관계",
  WORK: "직장",
  ECONOMY_CONSUMPTION: "경제·소비",
  TECH: "IT·테크",
  GAME: "게임",
  MOVIE_DRAMA: "영화·드라마",
  MUSIC_CONTENT: "음악·콘텐츠",
  SPORTS: "스포츠",
  EDUCATION: "교육",
  SOCIETY: "사회",
  HOBBY: "취미",
};

function isVisibleIdentity(
  identity: MemberPrivateProfile["identities"][number],
): identity is MemberPrivateProfile["identities"][number] & {
  provider: keyof typeof IDENTITY_LABELS;
} {
  return identity.provider !== "DEVELOPMENT";
}

function accountDeletionMessage(error: AccountDeletionError, status: number) {
  if (error.code === "CREDENTIAL_INVALID") return "현재 비밀번호가 올바르지 않습니다.";
  if (error.code === "CREDENTIAL_REQUIRED") {
    return "회원 탈퇴 전에 이메일과 비밀번호 로그인을 먼저 설정해 주세요.";
  }
  if (status === 401) return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
  return error.message || "회원 탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function readProfile(cursor?: string) {
  const query = new URLSearchParams({ limit: "3" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/me?${query}`, { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Profile read failed");
  return (await response.json()) as MemberPrivateProfile;
}

async function readRecentSubmissions() {
  const response = await fetch("/api/issue-submissions?limit=3", { cache: "no-store" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error("Submission read failed");
  const body = (await response.json()) as { items?: MemberIssueSubmission[] };
  return Array.isArray(body.items) ? body.items : [];
}

function resultPercent(vote: MemberPrivateVote, code: ChoiceCode) {
  const count = (
    {
      A: vote.result.acceptedA,
      B: vote.result.acceptedB,
      C: vote.result.acceptedC ?? 0,
      D: vote.result.acceptedD ?? 0,
    } as const
  )[code];
  if (vote.result.displayedTotal === 0) return 0;
  return Math.round((count / vote.result.displayedTotal) * 100);
}

function joinedLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(
    new Date(value),
  );
}

function participatedLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function visibleVoteSummary(profile: MemberPrivateProfile) {
  if (profile.choiceSummary) return profile.choiceSummary;

  const majorityMatchCount = profile.votes.items.filter((vote) => {
    const counts = [
      vote.result.acceptedA,
      vote.result.acceptedB,
      ...(vote.choiceCount >= 3 ? [vote.result.acceptedC ?? 0] : []),
      ...(vote.choiceCount >= 4 ? [vote.result.acceptedD ?? 0] : []),
    ];
    const selectedCount = (
      {
        A: vote.result.acceptedA,
        B: vote.result.acceptedB,
        C: vote.result.acceptedC ?? 0,
        D: vote.result.acceptedD ?? 0,
      } as const
    )[vote.choice];
    return selectedCount === Math.max(...counts);
  }).length;
  const visibleCount = profile.votes.items.length;
  const majorityMatchPercent =
    visibleCount > 0 ? Math.round((majorityMatchCount / visibleCount) * 100) : 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;

  return {
    majorityMatchPercent,
    minorityChoicePercent: visibleCount > 0 ? 100 - majorityMatchPercent : 0,
    recentSevenDayCount: profile.votes.items.filter(
      (vote) => new Date(vote.acceptedAt).getTime() >= sevenDaysAgo,
    ).length,
  };
}

function IdentityMark({ provider }: { provider: keyof typeof IDENTITY_LABELS }) {
  if (provider === "X") {
    return <Image src="/icons/x-logo.png" width={14} height={14} alt="" aria-hidden="true" />;
  }
  return (
    <b className={styles[`identityMark${provider}`]} aria-hidden="true">
      {provider === "GOOGLE" ? "G" : provider === "EMAIL" ? "@" : provider.slice(0, 1)}
    </b>
  );
}

const SUBMISSION_STATUS_LABELS = {
  PROCESSING: "처리 중",
  PUBLISHED: "게시 완료",
  NEEDS_CHANGES: "수정 필요",
  REJECTED: "게시 불가",
  QUARANTINED: "공개 보류",
} as const;

function submissionStatusLabel(submission: MemberIssueSubmission) {
  if (submission.publishedIssueId) return SUBMISSION_STATUS_LABELS.PUBLISHED;
  const state = submission.publicationState;
  if (state && state !== "CANCELLED") return SUBMISSION_STATUS_LABELS[state];
  return submission.status === "NEEDS_CHANGES" || submission.status === "REJECTED"
    ? SUBMISSION_STATUS_LABELS[submission.status]
    : SUBMISSION_STATUS_LABELS.PROCESSING;
}

function submissionChoices(submission: MemberIssueSubmission) {
  return [
    ["A", submission.choiceA],
    ["B", submission.choiceB],
    ["C", submission.choiceC],
    ["D", submission.choiceD],
  ].filter((choice): choice is [string, string] => Boolean(choice[1]));
}

export function MemberProfileExperience({
  creationEnabled = false,
}: {
  creationEnabled?: boolean;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<MemberPrivateProfile | null>(null);
  const [submissions, setSubmissions] = useState<MemberIssueSubmission[] | null>(null);
  const [shop, setShop] = useState<MemberPointShopView | null>(null);
  const [interestCodes, setInterestCodes] = useState<InterestCardCode[]>([]);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [accountDeletionOpen, setAccountDeletionOpen] = useState(false);
  const [accountDeletionPassword, setAccountDeletionPassword] = useState("");
  const [accountDeletionConfirmation, setAccountDeletionConfirmation] = useState("");
  const [accountDeletionPending, setAccountDeletionPending] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<string | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const profileEditButton = useRef<HTMLButtonElement>(null);
  const profileSettingsCloseButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      const next = await readProfile();
      if (!next) {
        setProfile(null);
        setScreen("guest");
        return;
      }
      setProfile(next);
      setScreen("ready");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void readProfile()
      .then((next) => {
        if (!active) return;
        if (!next) {
          setProfile(null);
          setScreen("guest");
          return;
        }
        setProfile(next);
        setScreen("ready");
      })
      .catch(() => {
        if (active) setScreen("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profileSettingsOpen) return;
    const returnFocus = profileEditButton.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      profileSettingsCloseButton.current?.focus(),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileSettingsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [profileSettingsOpen]);

  useEffect(() => {
    if (screen !== "ready" || !profile) return;
    let active = true;
    void readRecentSubmissions()
      .then((items) => {
        if (active) setSubmissions(items.filter((item) => item.status !== "CANCELLED").slice(0, 3));
      })
      .catch(() => {
        if (active) setSubmissions([]);
      });
    return () => {
      active = false;
    };
  }, [profile, screen]);

  useEffect(() => {
    if (screen !== "ready" || !profile) return;
    let active = true;
    void loadInterestProfile()
      .then((interestProfile) => {
        if (active) {
          setInterestCodes(
            Array.isArray(interestProfile?.selectedCardCodes)
              ? interestProfile.selectedCardCodes
              : [],
          );
        }
      })
      .catch(() => {
        if (active) setInterestCodes([]);
      });
    return () => {
      active = false;
    };
  }, [profile, screen]);

  useEffect(() => {
    let active = true;
    void fetch("/api/me/point-shop", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as MemberPointShopView) : null,
      )
      .then((next) => {
        if (active && next) setShop(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const profileAccent = equippedShopItem(shop, "PROFILE_ACCENT");
  const avatarFrame = equippedShopItem(shop, "AVATAR_FRAME");
  const choiceSummary = profile ? visibleVoteSummary(profile) : null;
  const accountDeletionPanel = profile ? (
    <section
      className={`${styles.accountDeletion} ${styles.accountDeletionRail}`}
      aria-labelledby="account-deletion-title"
    >
      <div>
        <p>DELETE ACCOUNT</p>
        <h2 id="account-deletion-title">회원 탈퇴</h2>
        <span>
          이메일·비밀번호·연결한 소셜 로그인·프로필·관심사는 삭제되고 모든 기기에서 로그아웃됩니다.
          질문·투표·댓글·반응은 통계와 대화의 맥락을 위해 개인 식별 정보와 분리되어{" "}
          <strong>탈퇴한 사용자</strong> 기록으로 유지됩니다.
        </span>
      </div>
      {!accountDeletionOpen ? (
        <button type="button" onClick={() => setAccountDeletionOpen(true)}>
          회원 탈퇴
        </button>
      ) : (
        <form
          className={styles.accountDeletionForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              accountDeletionPending ||
              !accountDeletionPassword ||
              accountDeletionConfirmation !== "탈퇴합니다"
            ) {
              return;
            }
            setAccountDeletionPending(true);
            setAccountDeletionError(null);
            void fetch("/api/me", {
              method: "DELETE",
              cache: "no-store",
              credentials: "same-origin",
              headers: {
                "content-type": "application/json",
                "x-which-csrf": "member-account-delete",
              },
              body: JSON.stringify({
                password: accountDeletionPassword,
                confirmation: accountDeletionConfirmation,
              }),
            })
              .then(async (response) => {
                const body = (await response.json().catch(() => ({}))) as AccountDeletionError & {
                  deleted?: boolean;
                };
                if (!response.ok || body.deleted !== true) {
                  throw new Error(accountDeletionMessage(body, response.status));
                }
                setAccountDeleted(true);
                setProfile(null);
                setScreen("guest");
              })
              .catch((error: unknown) => {
                setAccountDeletionError(
                  error instanceof Error
                    ? error.message
                    : "회원 탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                );
              })
              .finally(() => setAccountDeletionPending(false));
          }}
        >
          <p className={styles.accountDeletionWarning} role="alert">
            이 작업은 되돌릴 수 없습니다. 계속하려면 현재 비밀번호로 본인 확인을 완료해 주세요.
          </p>
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={accountDeletionPassword}
              onChange={(event) => setAccountDeletionPassword(event.target.value)}
              disabled={accountDeletionPending}
            />
          </label>
          <label>
            확인을 위해 &quot;탈퇴합니다&quot; 입력
            <input
              type="text"
              autoComplete="off"
              value={accountDeletionConfirmation}
              onChange={(event) => setAccountDeletionConfirmation(event.target.value)}
              disabled={accountDeletionPending}
            />
          </label>
          {accountDeletionError ? (
            <p className={styles.accountDeletionError} role="alert">
              {accountDeletionError}
            </p>
          ) : null}
          <div className={styles.accountDeletionActions}>
            <button
              type="button"
              disabled={accountDeletionPending}
              onClick={() => {
                setAccountDeletionOpen(false);
                setAccountDeletionPassword("");
                setAccountDeletionConfirmation("");
                setAccountDeletionError(null);
              }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={
                accountDeletionPending ||
                !accountDeletionPassword ||
                accountDeletionConfirmation !== "탈퇴합니다"
              }
            >
              {accountDeletionPending ? "탈퇴 처리 중…" : "회원 탈퇴 확정"}
            </button>
          </div>
        </form>
      )}
    </section>
  ) : null;

  return (
    <WhichShell
      active="me"
      creationEnabled={creationEnabled}
      aside={
        screen === "ready" && profile ? (
          <MemberPointPanel onShopChange={setShop} footer={accountDeletionPanel} />
        ) : undefined
      }
      preserveAsideOnNarrow={screen === "ready" && Boolean(profile)}
    >
      <div className={styles.page}>
        {screen === "loading" ? (
          <section className={styles.message} aria-busy="true" aria-live="polite">
            <p>PRIVATE ME</p>
            <h1>내 선택을 불러오는 중</h1>
            <span>계정에 연결된 기록만 안전하게 확인하고 있어요.</span>
          </section>
        ) : null}

        {screen === "guest" ? (
          <section className={styles.message}>
            <p>PRIVATE ME</p>
            <h1>
              {accountDeleted ? "회원 탈퇴가 완료되었습니다." : "로그인하면 내 선택이 이어져요."}
            </h1>
            <span>
              {accountDeleted
                ? "모든 기기에서 로그아웃되었고 개인정보와 로그인 수단을 삭제했습니다. 기존 투표와 댓글은 탈퇴한 사용자로 익명화되어 유지됩니다."
                : "전체 투표 기록은 다른 사람에게 공개되지 않습니다. 로그인한 본인만 최근 참여와 결과를 확인할 수 있어요."}
            </span>
            {!accountDeleted ? (
              <p className={styles.guestPointHint}>
                Guest로 참여한 기록은 로그인 뒤 계정에 연결되며, 이후 활동부터 W Point 적립 내역을
                확인할 수 있어요.
              </p>
            ) : null}
            <div className={styles.loginOptions} aria-label="로그인 제공자 선택">
              <Link href="/login?returnTo=%2Fme">로그인 또는 빠른 회원가입</Link>
            </div>
          </section>
        ) : null}

        {screen === "error" ? (
          <section className={styles.message} role="alert">
            <p>CONNECTION LOST</p>
            <h1>내 기록을 불러오지 못했어요.</h1>
            <span>연결 상태를 확인한 뒤 다시 시도해 주세요.</span>
            <button type="button" onClick={() => void load()}>
              다시 불러오기
            </button>
          </section>
        ) : null}

        {screen === "ready" && profile ? (
          <>
            <section
              className={styles.profile}
              aria-labelledby="profile-title"
              style={profileAccentStyle(profileAccent)}
            >
              <div className={styles.profileTopbar}>
                <p>
                  <Image
                    className={styles.lockIcon}
                    src="/icons/profile/lock.png"
                    width={14}
                    height={14}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className={styles.desktopEyebrow}>PRIVATE MEMBER PROFILE</span>
                  <span className={styles.mobileEyebrow}>비공개 프로필</span>
                </p>
                <button
                  aria-label="로그아웃"
                  className={styles.profileLogoutButton}
                  disabled={logoutPending}
                  onClick={() => {
                    setLogoutPending(true);
                    void logoutMemberSession()
                      .then(() => {
                        toast.success("로그아웃했어요.");
                        router.replace("/");
                      })
                      .catch(() => toast.error(MEMBER_LOGOUT_ERROR))
                      .finally(() => setLogoutPending(false));
                  }}
                  type="button"
                >
                  <Image
                    src="/icons/profile/logout.png"
                    width={16}
                    height={16}
                    alt=""
                    aria-hidden="true"
                  />
                  <span>{logoutPending ? "로그아웃 중…" : "로그아웃"}</span>
                </button>
              </div>

              <div className={styles.profileMain}>
                <div className={styles.profileIdentity}>
                  <div className={styles.cosmeticAvatarFrame} style={avatarFrameStyle(avatarFrame)}>
                    <MemberAvatarSettings
                      member={profile.member}
                      onUpdated={(member) =>
                        setProfile((current) =>
                          current
                            ? { ...current, member: { ...current.member, ...member } }
                            : current,
                        )
                      }
                    />
                  </div>
                  <div className={styles.profileIdentityCopy}>
                    <h1 id="profile-title" aria-label={`${profile.member.displayName}님의 선택`}>
                      {profile.member.displayName}
                    </h1>
                    {profile.publicProfile?.handle ? (
                      <p className={styles.profileHandle}>@{profile.publicProfile.handle}</p>
                    ) : null}
                    <p className={styles.joinedAt}>
                      <Image
                        className={styles.calendarIcon}
                        src="/icons/profile/calendar.png"
                        width={14}
                        height={14}
                        alt=""
                        aria-hidden="true"
                      />
                      {joinedLabel(profile.member.joinedAt)}부터 WHICH에 참여했어요.
                    </p>
                    <div className={styles.identityChips} aria-label="연결된 로그인 수단">
                      {profile.identities.filter(isVisibleIdentity).map((identity) => (
                        <span key={identity.provider}>
                          <IdentityMark provider={identity.provider} />
                          {IDENTITY_LABELS[identity.provider]} 계정
                        </span>
                      ))}
                      <span>
                        <Image
                          className={styles.miniLockIcon}
                          src={
                            profile.publicProfile?.visibility === "PUBLIC"
                              ? "/icons/profile/unlock.png"
                              : "/icons/profile/lock.png"
                          }
                          width={12}
                          height={12}
                          alt=""
                          aria-hidden="true"
                        />
                        {profile.publicProfile?.visibility === "PUBLIC"
                          ? "공개 프로필"
                          : "비공개 프로필"}
                      </span>
                    </div>
                  </div>
                  <button
                    aria-label="프로필 편집"
                    aria-expanded={profileSettingsOpen}
                    aria-haspopup="dialog"
                    className={styles.profileEditLink}
                    onClick={() => setProfileSettingsOpen(true)}
                    ref={profileEditButton}
                    type="button"
                  >
                    <span aria-hidden="true">✎</span>
                    <span className={styles.profileEditLabel}>프로필 편집</span>
                  </button>
                </div>

                <div className={styles.profileSummaryColumn} aria-label="나의 선택 요약">
                  <h2>나의 선택 요약</h2>
                  <div className={styles.summaryMetrics}>
                    <div className={styles.summaryMetric}>
                      <span>참여한 질문</span>
                      <strong>
                        {profile.member.participationCount.toLocaleString("ko-KR")}
                        <small>개</small>
                      </strong>
                      <p>지금까지 참여한 질문 수</p>
                    </div>
                    <div className={`${styles.summaryMetric} ${styles.majorityMetric}`}>
                      <span>다수 의견과 일치</span>
                      <strong>{choiceSummary?.majorityMatchPercent ?? 0}%</strong>
                      <p>다수 의견을 선택했어요</p>
                    </div>
                    <div className={`${styles.summaryMetric} ${styles.minorityMetric}`}>
                      <span>소수 의견과 일치</span>
                      <strong>{choiceSummary?.minorityChoicePercent ?? 0}%</strong>
                      <p>소수 의견과 일치했어요</p>
                    </div>
                  </div>
                  <div
                    className={styles.opinionBar}
                    role="img"
                    aria-label={`다수 의견 ${choiceSummary?.majorityMatchPercent ?? 0}%, 소수 의견 ${choiceSummary?.minorityChoicePercent ?? 0}%`}
                  >
                    <div
                      className={`${styles.opinionTrack} ${
                        profile.member.participationCount === 0 ? styles.emptyOpinionTrack : ""
                      }`}
                    >
                      <span
                        className={styles.majorityBar}
                        style={{ width: `${choiceSummary?.majorityMatchPercent ?? 0}%` }}
                      />
                      <span className={styles.minorityBar} />
                      <i
                        aria-hidden="true"
                        style={{ left: `${choiceSummary?.majorityMatchPercent ?? 0}%` }}
                      />
                    </div>
                    <div className={styles.opinionLabels}>
                      <span>다수 의견</span>
                      <span>소수 의견</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.profileFooter}>
                <div className={styles.interestSummary}>
                  <strong>
                    <Image
                      className={styles.bookmarkIcon}
                      src="/icons/profile/bookmark.png"
                      width={14}
                      height={14}
                      alt=""
                      aria-hidden="true"
                    />
                    관심 주제
                  </strong>
                  <div>
                    {interestCodes.length > 0 ? (
                      interestCodes
                        .slice(0, 4)
                        .map((code) => <span key={code}>{INTEREST_LABELS[code]}</span>)
                    ) : (
                      <span className={styles.emptyInterest}>아직 설정 전</span>
                    )}
                  </div>
                </div>
                <div className={styles.recentSummary}>
                  <strong>
                    <Image
                      className={styles.clockIcon}
                      src="/icons/profile/clock.png"
                      width={14}
                      height={14}
                      alt=""
                      aria-hidden="true"
                    />
                    최근 활동
                  </strong>
                  <p>
                    최근 7일간 {choiceSummary?.recentSevenDayCount.toLocaleString("ko-KR") ?? 0}개의
                    질문에 참여했어요.
                  </p>
                </div>
              </div>
            </section>

            <MemberProfileTabs active="profile" />

            {profileSettingsOpen ? (
              <div
                className={styles.profileSettingsBackdrop}
                onMouseDown={() => setProfileSettingsOpen(false)}
              >
                <div
                  aria-labelledby="public-profile-title"
                  aria-modal="true"
                  className={styles.profileSettingsModal}
                  onMouseDown={(event) => event.stopPropagation()}
                  role="dialog"
                >
                  <button
                    aria-label="프로필 설정 닫기"
                    className={styles.profileSettingsClose}
                    onClick={() => setProfileSettingsOpen(false)}
                    ref={profileSettingsCloseButton}
                    type="button"
                  >
                    ×
                  </button>
                  <MemberPublicProfileSettings
                    value={profile.publicProfile}
                    onUpdated={(publicProfile) => {
                      setProfile((current) => (current ? { ...current, publicProfile } : current));
                      setProfileSettingsOpen(false);
                    }}
                  />
                </div>
              </div>
            ) : null}

            <section
              className={`${styles.history} ${styles.voteHistory}`}
              aria-labelledby="history-title"
            >
              <div className={styles.historyHeading}>
                <div>
                  <p>VOTE HISTORY</p>
                  <h2 id="history-title">최근 참여</h2>
                </div>
                <span>본인에게만 보여요</span>
              </div>

              {profile.votes.items.length === 0 ? (
                <div className={styles.empty}>
                  <h3>아직 연결된 선택이 없어요.</h3>
                  <p>첫 질문에 참여하면 결과와 함께 이곳에 기록됩니다.</p>
                  <Link href="/">질문 고르기</Link>
                </div>
              ) : (
                <div className={styles.voteGrid}>
                  {profile.votes.items.slice(0, 3).map((vote) => (
                    <article className={styles.voteCard} key={vote.voteId}>
                      <div className={styles.voteMeta}>
                        <span>{vote.categoryCode.replaceAll("_", " ")}</span>
                        <time dateTime={vote.acceptedAt}>{participatedLabel(vote.acceptedAt)}</time>
                      </div>
                      <h3>{vote.question}</h3>
                      <div className={`${styles.choice} ${styles[`choice${vote.choice}`]}`}>
                        <span>{vote.choice}</span>
                        <strong>{vote.choiceLabel}</strong>
                        <em>{resultPercent(vote, vote.choice)}%</em>
                      </div>
                      <Link href={`/issues/${vote.issueId}`}>
                        최신 결과 보기
                        <Image
                          src="/icons/double-chevron.png"
                          width={24}
                          height={24}
                          alt=""
                          aria-hidden="true"
                        />
                      </Link>
                    </article>
                  ))}
                </div>
              )}

              {profile.votes.items.length > 0 ? (
                <Link className={styles.viewAllLink} href="/me/votes">
                  전체 투표 기록 보기 <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </section>

            <section
              className={`${styles.history} ${styles.questionHistory}`}
              aria-labelledby="questions-title"
            >
              <div className={styles.historyHeading}>
                <div>
                  <p>MY QUESTIONS</p>
                  <h2 id="questions-title">내 질문</h2>
                </div>
                <span>본인에게만 보여요</span>
              </div>

              {submissions === null ? (
                <div className={styles.empty} aria-busy="true" aria-live="polite">
                  <h3>내 질문을 불러오고 있어요.</h3>
                </div>
              ) : submissions.length === 0 ? (
                <div className={styles.empty}>
                  <h3>아직 만든 질문이 없어요.</h3>
                  <p>질문을 만들면 게시 상태와 선택지를 이곳에서 확인할 수 있어요.</p>
                  {creationEnabled ? <Link href="/create">질문 만들기</Link> : null}
                </div>
              ) : (
                <div className={styles.voteGrid}>
                  {submissions.map((submission) => (
                    <article className={styles.voteCard} key={submission.id}>
                      <div className={styles.voteMeta}>
                        <span>{submission.interestCardCode.replaceAll("_", " ")}</span>
                        <time dateTime={submission.submittedAt}>
                          {participatedLabel(submission.submittedAt)}
                        </time>
                      </div>
                      <h3>{submission.question}</h3>
                      <div className={styles.questionChoices}>
                        {submissionChoices(submission).map(([code, label]) => (
                          <span key={code}>
                            <b>{code}</b>
                            {label}
                          </span>
                        ))}
                      </div>
                      <div className={styles.questionStatus}>
                        <span>{submissionStatusLabel(submission)}</span>
                        <small>수정본 {submission.revision}</small>
                      </div>
                      <Link href="/me/submissions">
                        내 질문에서 보기
                        <Image
                          src="/icons/double-chevron.png"
                          width={24}
                          height={24}
                          alt=""
                          aria-hidden="true"
                        />
                      </Link>
                    </article>
                  ))}
                </div>
              )}

              {submissions && submissions.length > 0 ? (
                <Link className={styles.viewAllLink} href="/me/submissions">
                  전체 내 질문 보기 <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </WhichShell>
  );
}
