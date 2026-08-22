"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { loginHref } from "@/lib/auth";
import type { MemberPrivateProfile, MemberPrivateVote } from "@/lib/contracts";
import { logoutMemberSession, MEMBER_LOGOUT_ERROR } from "@/lib/member-session";

import styles from "./member-profile-experience.module.css";
import { MemberPublicProfileSettings } from "./member-public-profile-settings";

type Screen = "loading" | "guest" | "ready" | "error";
type AccountLinkNotice = {
  tone: "success" | "warning" | "error";
  message: string;
};

function readAccountLinkNotice(): AccountLinkNotice | null {
  if (window.location.hash !== "#connected-accounts") return null;

  const outcome = new URLSearchParams(window.location.search).get("auth");
  if (outcome === "success") {
    return {
      tone: "success",
      message: "로그인 수단을 연결했습니다. 연결된 Guest 기록도 같은 회원에게 이어집니다.",
    };
  }
  if (outcome === "merge-review") {
    return {
      tone: "warning",
      message: "이 계정에는 별도 활동 또는 충돌이 있어 자동 병합하지 않았습니다.",
    };
  }
  if (outcome === "error") {
    return {
      tone: "error",
      message: "로그인 수단을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  return null;
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

const socialProviders = [
  { id: "GOOGLE", login: "google", label: "Google" },
  { id: "X", login: "x", label: "X" },
  { id: "NAVER", login: "naver", label: "네이버" },
  { id: "KAKAO", login: "kakao", label: "카카오" },
] as const;

export function MemberProfileExperience({
  kakaoLoginEnabled,
  naverLoginEnabled,
}: {
  kakaoLoginEnabled?: boolean;
  naverLoginEnabled: boolean;
}) {
  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<MemberPrivateProfile | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [accountLinkNotice, setAccountLinkNotice] = useState<AccountLinkNotice | null>(null);

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
    const notice = readAccountLinkNotice();
    if (notice) {
      queueMicrotask(() => {
        if (active) setAccountLinkNotice(notice);
      });
    }

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
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="WHICH 홈">
          WHICH<span>.</span>
        </Link>
        <Link className={styles.feedLink} href="/">
          질문 둘러보기
        </Link>
      </header>

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
          <h1>로그인하면 내 선택이 이어져요.</h1>
          <span>
            전체 투표 기록은 다른 사람에게 공개되지 않습니다. 로그인한 본인만 최근 참여와 결과를
            확인할 수 있어요.
          </span>
          <div className={styles.loginOptions} aria-label="로그인 제공자 선택">
            <a href={loginHref("google", "/me")}>Google로 로그인</a>
            <a className={styles.xLogin} href={loginHref("x", "/me")}>
              X로 로그인
            </a>
            {naverLoginEnabled ? (
              <a className={styles.naverLogin} href={loginHref("naver", "/me")}>
                네이버로 로그인
              </a>
            ) : null}
            {kakaoLoginEnabled ? (
              <a className={styles.kakaoLogin} href={loginHref("kakao", "/me")}>
                카카오로 로그인
              </a>
            ) : null}
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
            <div>
              <p>PRIVATE MEMBER PROFILE</p>
              <h1 id="profile-title">{profile.member.displayName}님의 선택</h1>
              <span>{joinedLabel(profile.member.joinedAt)}부터 WHICH에 참여했어요.</span>
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

          <section
            className={styles.connectedAccounts}
            id="connected-accounts"
            aria-labelledby="connected-accounts-title"
          >
            <div className={styles.connectedAccountsHeading}>
              <div>
                <p>CONNECTED ACCOUNTS</p>
                <h2 id="connected-accounts-title">로그인 수단 연결</h2>
              </div>
              <span>어느 수단으로 로그인해도 같은 기록으로 연결됩니다.</span>
            </div>
            {accountLinkNotice ? (
              <p
                className={styles.accountLinkNotice}
                data-tone={accountLinkNotice.tone}
                role={accountLinkNotice.tone === "success" ? "status" : "alert"}
              >
                {accountLinkNotice.message}
              </p>
            ) : null}
            <div className={styles.providerGrid}>
              {socialProviders.map((provider) => {
                const enabled =
                  provider.id === "GOOGLE" ||
                  provider.id === "X" ||
                  (provider.id === "NAVER" && naverLoginEnabled) ||
                  (provider.id === "KAKAO" && kakaoLoginEnabled);
                if (!enabled) return null;
                const connected = profile.identities.some(
                  (identity) => identity.provider === provider.id,
                );
                return (
                  <article className={styles.providerCard} key={provider.id}>
                    <div>
                      <strong>{provider.label}</strong>
                      <span>{connected ? "연결됨" : "연결되지 않음"}</span>
                    </div>
                    {connected ? (
                      <span className={styles.connectedBadge}>CONNECTED</span>
                    ) : (
                      <a href={loginHref(provider.login, "/me#connected-accounts", "link")}>
                        연결하기
                      </a>
                    )}
                  </article>
                );
              })}
            </div>
            <p className={styles.accountLinkNote}>
              계정 연결은 현재 로그인된 회원에게만 추가됩니다. 이메일이나 Guest 쿠키만으로 다른
              회원을 자동 병합하지 않습니다.
            </p>
          </section>

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
        </>
      ) : null}

      <footer className={styles.footer}>
        <span>YOUR CHOICE, PRIVATELY.</span>
        <span>WHICH · 2026</span>
      </footer>
    </main>
  );
}
