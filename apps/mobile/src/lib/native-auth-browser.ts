import * as WebBrowser from "expo-web-browser";

import type { MemberSessionView } from "@/contracts";

import type { NativeAuthProvider } from "./native-auth";

type NativeAuthManager = {
  begin(provider: NativeAuthProvider, anonymousSubjectId?: string): Promise<string>;
  complete(callbackUrl: string): Promise<MemberSessionView>;
  cancel(): Promise<void>;
};

export async function authenticateInSystemBrowser(
  manager: NativeAuthManager,
  provider: NativeAuthProvider,
  anonymousSubjectId?: string,
) {
  const startUrl = await manager.begin(provider, anonymousSubjectId);
  const result = await WebBrowser.openAuthSessionAsync(startUrl, "which://auth/callback");
  if (result.type !== "success") {
    await manager.cancel();
    return null;
  }
  return manager.complete(result.url);
}
