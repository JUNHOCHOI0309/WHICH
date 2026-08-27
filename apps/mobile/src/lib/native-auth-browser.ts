import * as WebBrowser from "expo-web-browser";

import type { MemberSessionView } from "@/contracts";

import type { NativeAuthProvider, NativeAuthReturnTo } from "./native-auth";

type NativeAuthManager = {
  begin(
    provider: NativeAuthProvider,
    anonymousSubjectId?: string,
    returnTo?: string,
  ): Promise<string>;
  complete(callbackUrl: string): Promise<{
    session: MemberSessionView;
    returnTo?: NativeAuthReturnTo;
  }>;
  cancel(): Promise<void>;
};

export async function authenticateInSystemBrowser(
  manager: NativeAuthManager,
  provider: NativeAuthProvider,
  anonymousSubjectId?: string,
  returnTo?: string,
) {
  const startUrl = await manager.begin(provider, anonymousSubjectId, returnTo);
  const result = await WebBrowser.openAuthSessionAsync(startUrl, "which://auth/callback");
  if (result.type !== "success") {
    await manager.cancel();
    return null;
  }
  return manager.complete(result.url);
}
