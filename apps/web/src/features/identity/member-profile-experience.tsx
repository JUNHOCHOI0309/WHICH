"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import type { MemberPrivateProfile, MemberPrivateVote } from "@/lib/contracts";
import { logoutMemberSession, MEMBER_LOGOUT_ERROR } from "@/lib/member-session";

import styles from "./member-profile-experience.module.css";
import { MemberPublicProfileSettings } from "./member-public-profile-settings";
import { MemberCredentialSetup } from "./member-credential-setup";

type Screen = "loading" | "guest" | "ready" | "error";

type AccountDeletionError = { code?: string; message?: string };

function accountDeletionMessage(error: AccountDeletionError, status: number) {
  if (error.code === "CREDENTIAL_INVALID") return "현재 비밀번호가 올바르지 않습니다.";
  if (error.code === "CREDENTIAL_REQUIRED") {
    return "회원 탈퇴 전에 이메일과 비밀번호 로그인을 먼저 설정해 주세요.";
  }
  if (status === 401) return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
  return error.message || "회원 탈퇴를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function readProfile(cursor?: string) {
  const query = new URLSearchParams({ limit: "12" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/me?${query}`, { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Profile read failed");
  return (await response.json()) as MemberPrivateProfile;
}

function resultPercent(vote: MemberPrivateVote, code: "A" | "B") {
  const count = code === "A" ? vote.result.acceptedA : vote.result.acceptedB;
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

function fallbackInitials(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return (
    (words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
      : words[0]?.slice(0, 2)) || "W"
  );
}

export function MemberProfileExperience() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<MemberPrivateProfile | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
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

  const loadMore = useCallback(async () => {
    const cursor = profile?.votes.nextCursor;
    if (!profile || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await readProfile(cursor);
      if (!next) {
        setProfile(null);
        setScreen("guest");
        return;
      }
      setProfile((current) =>
        current
          ? {
              ...next,
              votes: {
                items: [...current.votes.items, ...next.votes.items],
                nextCursor: next.votes.nextCursor,
              },
            }
          : next,
      );
    } catch {
      setScreen("error");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, profile]);

  return (
    <WhichShell
      active="me"
      aside={
        <WhichAsideCard
          eyebrow="PRIVATE BY DEFAULT"
          title="선택 기록은 로그인한 본인만 볼 수 있어요."
          tone="orange"
        >
          공개 프로필에는 내가 만든 질문만 선택적으로 노출됩니다.
        </WhichAsideCard>
      }
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
            <section className={styles.profile} aria-labelledby="profile-title">
              <div className={styles.profileIdentity}>
                {profile.member.avatar?.kind === "IMAGE" ? (
                  <img
                    className={styles.profileAvatar}
                    src={profile.member.avatar.url}
                    alt={`${profile.member.displayName} 프로필`}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className={styles.profileAvatarFallback} aria-hidden="true">
                    {profile.member.avatar?.kind === "INITIALS"
                      ? profile.member.avatar.initials
                      : fallbackInitials(profile.member.displayName)}
                  </span>
                )}
                <div>
                  <p>PRIVATE MEMBER PROFILE</p>
                  <h1 id="profile-title">{profile.member.displayName}님의 선택</h1>
                  <span>{joinedLabel(profile.member.joinedAt)}부터 WHICH에 참여했어요.</span>
                </div>
              </div>
              <div className={styles.summary} aria-label="참여 요약">
                <strong>{profile.member.participationCount.toLocaleString("ko-KR")}</strong>
                <span>참여한 질문</span>
              </div>
            </section>

            <MemberPublicProfileSettings
              value={profile.publicProfile}
              onUpdated={(publicProfile) =>
                setProfile((current) => (current ? { ...current, publicProfile } : current))
              }
            />

            {!profile.identities.some((identity) => identity.provider === "EMAIL") ? (
              <MemberCredentialSetup
                onCompleted={() =>
                  setProfile((current) =>
                    current
                      ? {
                          ...current,
                          identities: [
                            ...current.identities,
                            {
                              provider: "EMAIL",
                              linkedAt: new Date().toISOString(),
                              lastAuthenticatedAt: new Date().toISOString(),
                            },
                          ],
                        }
                      : current,
                  )
                }
              />
            ) : null}

            <section className={styles.history} aria-labelledby="history-title">
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
                  {profile.votes.items.map((vote) => (
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
                        최신 결과 보기 <span aria-hidden="true">↗</span>
                      </Link>
                    </article>
                  ))}
                </div>
              )}

              {profile.votes.nextCursor ? (
                <button
                  className={styles.moreButton}
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "기록을 더 불러오는 중…" : "이전 기록 더 보기"}
                </button>
              ) : null}
            </section>

            <section className={styles.privacyNote}>
              <div>
                <p>PRIVACY BY DEFAULT</p>
                <strong>선택 기록은 공개 프로필과 분리됩니다.</strong>
                <span>
                  댓글의 A/B 표시는 해당 질문 안에서만 보이며, 이 목록은 다른 사용자에게 제공되지
                  않아요.
                </span>
              </div>
              <button
                type="button"
                disabled={logoutPending}
                onClick={() => {
                  setLogoutPending(true);
                  setLogoutError(null);
                  void logoutMemberSession()
                    .then(() => {
                      setProfile(null);
                      setScreen("guest");
                    })
                    .catch(() => setLogoutError(MEMBER_LOGOUT_ERROR))
                    .finally(() => setLogoutPending(false));
                }}
              >
                {logoutPending ? "로그아웃 중…" : "로그아웃"}
              </button>
              {logoutError ? (
                <p className={styles.logoutError} role="alert">
                  {logoutError}
                </p>
              ) : null}
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
