import { cache } from "react";

import type { PublicCreatorProfile, PublicIssue, PublicIssueCatalog } from "@/lib/contracts";
import { fetchWhichApi } from "@/lib/server/which-api";

export type PublicReadResult<T> =
  { status: "available"; value: T } | { status: "missing" } | { status: "unavailable" };

export const readPublicIssueForDiscovery = cache(
  async (issueId: string): Promise<PublicReadResult<PublicIssue>> => {
    const response = await fetchWhichApi(`/v1/issues/${encodeURIComponent(issueId)}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { status: "missing" };
    if (response.status === 409) return { status: "unavailable" };
    if (!response.ok) {
      throw new Error(`Public Issue discovery read failed with status ${response.status}.`);
    }
    return { status: "available", value: (await response.json()) as PublicIssue };
  },
);

export const readPublicCreatorForDiscovery = cache(
  async (handle: string): Promise<PublicReadResult<PublicCreatorProfile>> => {
    const response = await fetchWhichApi(`/v1/profiles/${encodeURIComponent(handle)}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) {
      throw new Error(`Public creator discovery read failed with status ${response.status}.`);
    }
    return { status: "available", value: (await response.json()) as PublicCreatorProfile };
  },
);

export async function readPublicIssueCatalogForDiscovery(maximumItems = 500) {
  const requestedLimit = Number.isFinite(maximumItems) ? Math.floor(maximumItems) : 500;
  const limit = Math.min(500, Math.max(1, requestedLimit));
  const response = await fetchWhichApi(`/v1/issues/catalog?limit=${limit}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Public Issue catalog read failed with status ${response.status}.`);
  }
  return ((await response.json()) as PublicIssueCatalog).items;
}
