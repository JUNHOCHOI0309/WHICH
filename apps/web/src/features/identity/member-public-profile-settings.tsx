"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useState } from "react";

import type { ApiErrorBody, MemberProfileSettings } from "@/lib/contracts";

import styles from "./member-public-profile-settings.module.css";

export function MemberPublicProfileSettings({
  value,
  onUpdated,
}: {
  value: MemberProfileSettings | null;
  onUpdated: (profile: MemberProfileSettings) => void;
}) {
  const [handle, setHandle] = useState(value?.handle ?? "");
  const [bio, setBio] = useState(value?.bio ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">(
    value?.visibility ?? "PRIVATE",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, bio: bio.trim() || null, visibility }),
      });
      const body = (await response.json()) as MemberProfileSettings | ApiErrorBody;
      if (!response.ok) {
        const error = body as ApiErrorBody;
        if (error.code === "HANDLE_TAKEN") throw new Error("이미 사용 중인 Handle이에요.");
        if (error.code === "HANDLE_RESERVED") throw new Error("WHICH에서 예약한 Handle이에요.");
        if (error.code === "HANDLE_INVALID") {
          throw new Error("영문, 숫자, 밑줄로 3~30자를 입력해 주세요.");
        }
        throw new Error(error.message || "공개 프로필을 저장하지 못했습니다.");
      }
      const updated = body as MemberProfileSettings;
      setHandle(updated.handle);
      setBio(updated.bio ?? "");
      setVisibility(updated.visibility);
      onUpdated(updated);
      setMessage(
        updated.visibility === "PUBLIC"
          ? "공개 프로필을 저장했어요."
          : "프로필을 비공개로 전환했어요.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "공개 프로필을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.settings} aria-labelledby="public-profile-title">
      <div className={styles.heading}>
        <div>
          <p>PUBLIC CREATOR PROFILE</p>
          <h2 id="public-profile-title">질문을 만드는 나를 소개해요.</h2>
        </div>
        {value?.publicUrl ? <Link href={value.publicUrl}>공개 화면 보기 ↗</Link> : null}
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <label>
          <span>Handle</span>
          <div className={styles.handleField}>
            <strong>@</strong>
            <input
              autoCapitalize="none"
              autoComplete="username"
              maxLength={30}
              minLength={3}
              pattern="[A-Za-z0-9_]+"
              required
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="question_maker"
            />
          </div>
          <small>영문·숫자·밑줄 3~30자, 대소문자는 구분하지 않아요.</small>
        </label>

        <label>
          <span>짧은 소개</span>
          <textarea
            maxLength={160}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="어떤 질문을 만들고 싶은지 소개해 주세요."
          />
          <small>{bio.length}/160</small>
        </label>

        <fieldset>
          <legend>공개 범위</legend>
          <label>
            <input
              checked={visibility === "PUBLIC"}
              name="profile-visibility"
              type="radio"
              onChange={() => setVisibility("PUBLIC")}
            />
            <span>공개 — Handle 주소에서 작성한 질문을 보여줘요.</span>
          </label>
          <label>
            <input
              checked={visibility === "PRIVATE"}
              name="profile-visibility"
              type="radio"
              onChange={() => setVisibility("PRIVATE")}
            />
            <span>비공개 — 나만 설정을 볼 수 있어요.</span>
          </label>
        </fieldset>

        <div className={styles.actions}>
          <span role={message ? "status" : undefined}>{message}</span>
          <button disabled={saving} type="submit">
            {saving ? "저장 중…" : "프로필 저장"}
          </button>
        </div>
      </form>
    </section>
  );
}
