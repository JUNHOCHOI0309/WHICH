"use client";

import { useRef, useState } from "react";

import type { MemberPrivateProfile } from "@/lib/contracts";

import styles from "./member-profile-experience.module.css";

type Member = MemberPrivateProfile["member"];
type AvatarMemberUpdate = Pick<Member, "id" | "displayName" | "status" | "avatar">;
type AvatarApiResponse = { member?: AvatarMemberUpdate; message?: string };

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

export function MemberAvatarSettings({
  member,
  onUpdated,
}: {
  member: Member;
  onUpdated: (member: AvatarMemberUpdate) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyMember(next: AvatarMemberUpdate) {
    onUpdated(next);
    window.dispatchEvent(
      new CustomEvent("which:member-avatar-updated", { detail: { avatar: next.avatar } }),
    );
  }

  async function upload(file: File) {
    if (pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("avatar", file);
      const response = await fetch("/api/me/avatar", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "x-which-csrf": "member-avatar" },
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as AvatarApiResponse;
      if (!response.ok || !body.member) {
        throw new Error(body.message || "프로필 이미지를 저장하지 못했습니다.");
      }
      applyMember(body.member);
      setMessage("프로필 이미지를 변경했습니다.");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "프로필 이미지를 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/me/avatar", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-which-csrf": "member-avatar" },
      });
      const body = (await response.json().catch(() => ({}))) as AvatarApiResponse;
      if (!response.ok || !body.member) {
        throw new Error(body.message || "프로필 이미지를 삭제하지 못했습니다.");
      }
      applyMember(body.member);
      setMessage("프로필 이미지를 비웠습니다.");
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "프로필 이미지를 삭제하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  const avatar = member.avatar;
  const initials =
    avatar?.kind === "INITIALS" ? avatar.initials : fallbackInitials(member.displayName);

  return (
    <div className={styles.avatarControl} aria-busy={pending}>
      <div className={styles.avatarControlCircle}>
        <label
          className={styles.avatarPicker}
          aria-disabled={pending}
          title="프로필 이미지 선택 또는 변경"
        >
          {avatar?.kind === "IMAGE" ? (
            <img
              className={styles.profileAvatar}
              src={avatar.url}
              alt={`${member.displayName} 프로필`}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className={styles.profileAvatarFallback} aria-hidden="true">
              {initials}
            </span>
          )}
          <span className={styles.avatarPickerHint} aria-hidden="true">
            {pending ? "저장 중" : avatar?.kind === "IMAGE" ? "변경" : "선택"}
          </span>
          <input
            ref={fileInput}
            className={styles.avatarInput}
            type="file"
            aria-label="프로필 이미지 선택 또는 변경"
            accept="image/jpeg,image/png"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              setMessage(null);
              setError(null);
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                event.target.value = "";
                setError("프로필 이미지는 5MB 이하만 사용할 수 있습니다.");
                return;
              }
              void upload(file);
            }}
          />
        </label>
        {avatar?.kind === "IMAGE" ? (
          <button
            className={styles.avatarDeleteButton}
            type="button"
            disabled={pending}
            aria-label="프로필 이미지 삭제"
            onClick={() => void remove()}
          >
            삭제
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={styles.avatarSuccess} role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className={styles.avatarError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
