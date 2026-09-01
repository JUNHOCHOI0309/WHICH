"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/feedback/toast-provider";
import { WhichShell } from "@/components/layout/which-shell";
import type {
  ChoiceCode,
  MemberIssueSubmission,
  MemberPointShopView,
  MemberPrivateProfile,
  MemberPrivateVote,
} from "@/lib/contracts";
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
  const [logoutPending, setLogoutPending] = useState(false);
  const [accountDeletionOpen, setAccountDeletionOpen] = useState(false);
  const [accountDeletionPassword, setAccountDeletionPassword] = useState("");
  const [accountDeletionConfirmation, setAccountDeletionConfirmation] = useState("");
  const [accountDeletionPending, setAccountDeletionPending] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<string | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);

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

  return (
    <WhichShell
      active="me"
      creationEnabled={creationEnabled}
      aside={
        screen === "ready" && profile ? <MemberPointPanel onShopChange={setShop} /> : undefined
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
                  <div className={styles.profileIdentityHeading}>
                    <p>PRIVATE MEMBER PROFILE</p>
                  </div>
                  <h1 id="profile-title">{profile.member.displayName}님의 선택</h1>
                  <span>{joinedLabel(profile.member.joinedAt)}부터 WHICH에 참여했어요.</span>
                </div>
              </div>
              <div className={styles.profileSummaryColumn}>
                <div className={styles.identityChips} aria-label="연결된 로그인 수단">
                  {profile.identities.filter(isVisibleIdentity).map((identity) => (
                    <span key={identity.provider}>{IDENTITY_LABELS[identity.provider]}</span>
                  ))}
                </div>
                <div className={styles.summary} aria-label="참여 요약">
                  <strong>{profile.member.participationCount.toLocaleString("ko-KR")}</strong>
                  <span>참여한 질문</span>
                </div>
              </div>
            </section>

            <MemberProfileTabs active="profile" />

            <MemberPublicProfileSettings
              value={profile.publicProfile}
              onUpdated={(publicProfile) =>
                setProfile((current) => (current ? { ...current, publicProfile } : current))
              }
            />

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

            <section className={styles.privacyNote}>
              <div>
                <p>PRIVACY BY DEFAULT</p>
                <strong>선택 기록은 공개 프로필과 분리됩니다.</strong>
                <span>
                  댓글의 선택 표시는 해당 질문 안에서만 보이며, 이 목록은 다른 사용자에게 제공되지
                  않아요.
                </span>
              </div>
              <button
                type="button"
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
              >
                {logoutPending ? "로그아웃 중…" : "로그아웃"}
              </button>
            </section>

            <section className={styles.accountDeletion} aria-labelledby="account-deletion-title">
              <div>
                <p>DELETE ACCOUNT</p>
                <h2 id="account-deletion-title">회원 탈퇴</h2>
                <span>
                  이메일·비밀번호·연결한 소셜 로그인·프로필·관심사는 삭제되고 모든 기기에서
                  로그아웃됩니다. 질문·투표·댓글·반응은 통계와 대화의 맥락을 위해 개인 식별 정보와
                  분리되어 <strong>탈퇴한 사용자</strong> 기록으로 유지됩니다.
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
                        const body = (await response
                          .json()
                          .catch(() => ({}))) as AccountDeletionError & {
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
                    이 작업은 되돌릴 수 없습니다. 계속하려면 현재 비밀번호로 본인 확인을 완료해
                    주세요.
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
          </>
        ) : null}
      </div>
    </WhichShell>
  );
}
