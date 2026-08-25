import type { MemberAvatar } from "@/lib/contracts";

import {
  avatarStorageConfig,
  deleteStoredAvatar,
  readSocialAvatar,
  storeAvatar,
} from "./avatar-storage";
import { internalAuthSecret } from "./member-auth";
import { fetchWhichApi } from "./which-api";

type SocialProvider = "GOOGLE" | "X" | "NAVER" | "KAKAO";

export type AvatarMember = {
  id: string;
  displayName: string;
  status: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
  avatar: MemberAvatar;
};

type AvatarUpdateResponse = {
  updated: boolean;
  member: AvatarMember;
  replacedObjectKey: string | null;
  code?: string;
  message?: string;
};

async function bestEffortDelete(objectKey: string | null | undefined) {
  await deleteStoredAvatar(objectKey).catch(() => {
    console.warn("A replaced avatar object could not be deleted immediately.");
  });
}

async function memberForToken(token: string) {
  const upstream = await fetchWhichApi("/v1/member-session", {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const body = (await upstream.json()) as { member?: AvatarMember };
  return upstream.ok && body.member?.id ? body.member : null;
}

async function updateAvatarReference(
  token: string,
  input: {
    avatarUrl: string;
    objectKey: string;
    sourceProvider?: SocialProvider;
    expectedSourceUrl?: string;
  },
) {
  const upstream = await fetchWhichApi("/v1/internal/member-avatar", {
    method: "PUT",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-internal-auth-secret": internalAuthSecret(),
    },
    body: JSON.stringify(input),
  });
  const body = (await upstream.json()) as AvatarUpdateResponse;
  if (!upstream.ok || !body.member?.id) {
    throw new Error(body.code ?? "AVATAR_REFERENCE_UPDATE_FAILED");
  }
  return body;
}

export async function uploadMemberAvatar(token: string, input: Buffer) {
  const member = await memberForToken(token);
  if (!member) return null;
  const stored = await storeAvatar(member.id, input);
  try {
    const result = await updateAvatarReference(token, {
      avatarUrl: stored.url,
      objectKey: stored.objectKey,
    });
    if (!result.updated) await bestEffortDelete(stored.objectKey);
    if (result.replacedObjectKey) await bestEffortDelete(result.replacedObjectKey);
    return result.member;
  } catch (error) {
    await deleteStoredAvatar(stored.objectKey).catch(() => undefined);
    throw error;
  }
}

export async function removeMemberAvatar(token: string) {
  const upstream = await fetchWhichApi("/v1/internal/member-avatar", {
    method: "DELETE",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "x-internal-auth-secret": internalAuthSecret(),
    },
  });
  const body = (await upstream.json()) as AvatarUpdateResponse;
  if (!upstream.ok || !body.member?.id) return null;
  if (body.replacedObjectKey) await bestEffortDelete(body.replacedObjectKey);
  return body.member;
}

export async function cacheSocialAvatar(
  token: string,
  provider: SocialProvider,
  sourceUrl: string | undefined,
) {
  const config = avatarStorageConfig();
  if (!sourceUrl || !config) return;
  let stored: Awaited<ReturnType<typeof storeAvatar>> | undefined;
  try {
    const member = await memberForToken(token);
    if (!member) return;
    if (
      member.avatar.kind === "IMAGE" &&
      member.avatar.url.startsWith(`${config.publicBaseUrl}/avatars/`)
    ) {
      return;
    }
    const source = await readSocialAvatar(provider, sourceUrl);
    stored = await storeAvatar(member.id, source);
    const result = await updateAvatarReference(token, {
      avatarUrl: stored.url,
      objectKey: stored.objectKey,
      sourceProvider: provider,
      expectedSourceUrl: sourceUrl,
    });
    if (!result.updated) await bestEffortDelete(stored.objectKey);
    if (result.replacedObjectKey) await bestEffortDelete(result.replacedObjectKey);
  } catch (error) {
    if (stored) await deleteStoredAvatar(stored.objectKey).catch(() => undefined);
    console.warn("Social avatar caching was skipped.", {
      provider,
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
  }
}
