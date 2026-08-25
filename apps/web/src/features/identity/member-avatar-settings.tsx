"use client";

import { useRef, useState } from "react";

import type { MemberPrivateProfile } from "@/lib/contracts";

import styles from "./member-profile-experience.module.css";

type Member = MemberPrivateProfile["member"];
type AvatarApiResponse = { member?: Member; message?: string };

export function MemberAvatarSettings({
  member,
  onUpdated,
}: {
  member: Member;
  onUpdated: (member: Member) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyMember(next: Member) {
    onUpdated(next);
    window.dispatchEvent(
      new CustomEvent("which:member-avatar-updated", { detail: { avatar: next.avatar } }),
    );
  }

  async function upload() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("avatar", selected);
      const response = await fetch("/api/me/avatar", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "x-which-csrf": "member-avatar" },
        body: form,
      });
      const body = (await response.json().catch(() => ({}))) as AvatarApiResponse;
      if (!response.ok || !body.member)
        throw new Error(body.message || "프로필 이미지를 저장하지 못했습니다.");
      applyMember(body.member);
      setSelected(null);
      if (fileInput.current) fileInput.current.value = "";
      setMessage("프로필 이미지를 변경했습니다.");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "프로필 이미지를 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
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
      if (!response.ok || !body.member)
        throw new Error(body.message || "프로필 이미지를 삭제하지 못했습니다.");
      applyMember(body.member);
      setMessage("기본 이니셜 이미지로 변경했습니다.");
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "프로필 이미지를 삭제하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.avatarSettings} aria-labelledby="avatar-settings-title">
      <div>
        <p>PROFILE IMAGE</p>
        <h2 id="avatar-settings-title">프로필 이미지</h2>
        <span>5MB 이하 JPG 또는 PNG를 선택하세요. 저장할 때 512px WebP로 자동 변환합니다.</span>
      </div>
      <div className={styles.avatarSettingsControls}>
        <label className={styles.avatarFileLabel}>
          이미지 선택
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setMessage(null);
              setError(null);
              if (file && file.size > 5 * 1024 * 1024) {
                setSelected(null);
                setError("프로필 이미지는 5MB 이하만 사용할 수 있습니다.");
                return;
              }
              setSelected(file);
            }}
          />
        </label>
        <button type="button" disabled={!selected || pending} onClick={() => void upload()}>
          {pending && selected ? "변환·저장 중…" : "이미지 변경"}
        </button>
        {member.avatar?.kind === "IMAGE" ? (
          <button
            className={styles.avatarRemoveButton}
            type="button"
            disabled={pending}
            onClick={() => void remove()}
          >
            이미지 삭제
          </button>
        ) : null}
      </div>
      {selected ? <p className={styles.avatarFileName}>선택한 파일: {selected.name}</p> : null}
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
    </section>
  );
}
