import type { ChoiceCode, PublicShareCard, ShareChannel } from "@/lib/contracts";
import { authBaseUrl, internalAuthSecret } from "@/lib/server/member-auth";
import { fetchWhichApi } from "@/lib/server/which-api";

export async function createResultShareCard(
  requestUrl: string,
  issueId: string,
  command: {
    issueVersion: number;
    resultVersion: number;
    channel: ShareChannel;
    sharedChoiceCode?: ChoiceCode;
  },
) {
  const upstream = await fetchWhichApi(
    `/v1/internal/issues/${encodeURIComponent(issueId)}/share-cards`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-internal-auth-secret": internalAuthSecret(),
      },
      body: JSON.stringify(command),
    },
  );
  const body = (await upstream.json()) as PublicShareCard | { code: string; message: string };
  if (!upstream.ok || !("id" in body)) return { upstream, body };

  const url = new URL(`/issues/${encodeURIComponent(issueId)}`, authBaseUrl(requestUrl));
  url.searchParams.set("share", body.id);
  url.searchParams.set("utm_source", "share");
  url.searchParams.set("utm_medium", command.channel.toLowerCase());
  url.searchParams.set("utm_campaign", command.sharedChoiceCode ? "result_with_choice" : "result");
  url.searchParams.set("utm_content", body.id);
  return { upstream, body: { shareCard: body, url: url.toString() } };
}

export async function readResultShareCard(shareCardId: string) {
  return fetchWhichApi(`/v1/share-cards/${encodeURIComponent(shareCardId)}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
}
