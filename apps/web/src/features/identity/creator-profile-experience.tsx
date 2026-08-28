"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { WhichAsideCard, WhichShell } from "@/components/layout/which-shell";
import type { PublicCreatorProfile } from "@/lib/contracts";

import styles from "./creator-profile-experience.module.css";

type Screen = "loading" | "ready" | "missing" | "error";

function joinedLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year}년 ${Number(month)}월부터`;
}

function publishedLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

async function readCreatorProfile(handle: string) {
  const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Creator profile read failed");
  return (await response.json()) as PublicCreatorProfile;
}

export function CreatorProfileExperience({
  handle,
  initialProfile,
}: {
  handle: string;
  initialProfile?: PublicCreatorProfile;
}) {
  const [screen, setScreen] = useState<Screen>(initialProfile ? "ready" : "loading");
  const [profile, setProfile] = useState<PublicCreatorProfile | null>(initialProfile ?? null);

  const load = useCallback(async () => {
    try {
      const next = await readCreatorProfile(handle);
      if (!next) {
        setProfile(null);
        setScreen("missing");
        return;
      }
      setProfile(next);
      setScreen("ready");
    } catch {
      setProfile(null);
      setScreen("error");
    }
  }, [handle]);

  useEffect(() => {
    if (initialProfile) return;
    let active = true;
    void readCreatorProfile(handle)
      .then((next) => {
        if (!active) return;
        if (!next) {
          setProfile(null);
          setScreen("missing");
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
  }, [handle, initialProfile]);

  return (
    <WhichShell
      active="home"
      aside={
        <WhichAsideCard
          eyebrow="PUBLIC PROFILE"
          title="사람보다 좋은 질문을 먼저 봅니다."
          tone="orange"
        >
          작성자의 선택 기록은 공개하지 않고, 만든 질문과 공개 성과만 보여줘요.
        </WhichAsideCard>
      }
    >
      <div className={styles.page}>
        {screen === "loading" ? (
          <section className={styles.message} aria-busy="true" aria-live="polite">
            <p>CREATOR PROFILE</p>
            <h1>작성자의 질문을 불러오는 중</h1>
          </section>
        ) : null}

        {screen === "missing" ? (
          <section className={styles.message}>
            <p>PROFILE NOT FOUND</p>
            <h1>공개된 작성자 프로필이 없어요.</h1>
            <span>주소가 바뀌었거나 작성자가 프로필을 비공개로 전환했을 수 있습니다.</span>
            <Link href="/">다른 질문 보기</Link>
          </section>
        ) : null}

        {screen === "error" ? (
          <section className={styles.message} role="alert">
            <p>CONNECTION LOST</p>
            <h1>프로필을 불러오지 못했어요.</h1>
            <button
              type="button"
              onClick={() => {
                setScreen("loading");
                void load();
              }}
            >
              다시 불러오기
            </button>
          </section>
        ) : null}

        {screen === "ready" && profile ? (
          <>
            <section className={styles.hero} aria-labelledby="creator-name">
              <div className={styles.avatar} aria-hidden="true">
                {profile.creator.avatar.kind === "IMAGE" ? (
                  <img src={profile.creator.avatar.url} alt="" referrerPolicy="no-referrer" />
                ) : (
                  profile.creator.avatar.initials
                )}
              </div>
              <div className={styles.identity}>
                <p>QUESTION CREATOR</p>
                <h1 id="creator-name">{profile.creator.displayName}</h1>
                <strong>@{profile.creator.handle}</strong>
                <span>{profile.creator.bio ?? "두 선택지 사이의 좋은 질문을 만듭니다."}</span>
                <small>{joinedLabel(profile.creator.joinedMonth)} WHICH와 함께했어요.</small>
              </div>
              <div className={styles.stats} aria-label="Creator 공개 성과">
                <div>
                  <strong>{profile.stats.publishedIssueCount.toLocaleString("ko-KR")}</strong>
                  <span>공개 질문</span>
                </div>
                <div>
                  <strong>{profile.stats.acceptedVoteCount.toLocaleString("ko-KR")}</strong>
                  <span>받은 정상 투표</span>
                </div>
              </div>
            </section>

            <section className={styles.issues} aria-labelledby="creator-issues">
              <div className={styles.sectionHeading}>
                <div>
                  <p>RECENT QUESTIONS</p>
                  <h2 id="creator-issues">이 작성자가 만든 질문</h2>
                </div>
                <span>선택 기록은 공개되지 않아요</span>
              </div>

              {profile.issues.length === 0 ? (
                <div className={styles.empty}>
                  <h3>아직 공개된 질문이 없어요.</h3>
                  <p>작성자의 첫 질문이 게시되면 이곳에서 확인할 수 있습니다.</p>
                </div>
              ) : (
                <div className={styles.issueGrid}>
                  {profile.issues.map((issue) => (
                    <article key={issue.id}>
                      <div>
                        <span>{issue.categoryCode.replaceAll("_", " ")}</span>
                        <time dateTime={issue.publishedAt}>
                          {publishedLabel(issue.publishedAt)}
                        </time>
                      </div>
                      <h3>{issue.question}</h3>
                      <p>{issue.acceptedVoteCount.toLocaleString("ko-KR")}명이 선택했어요.</p>
                      <Link href={`/issues/${issue.id}`}>질문 참여하기 →</Link>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </WhichShell>
  );
}
