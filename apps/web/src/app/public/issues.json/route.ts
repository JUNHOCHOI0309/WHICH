import type { NextRequest } from "next/server";

import {
  publicIssueCatalogGet,
  publicIssueCatalogOptions,
} from "@/lib/server/public-issue-catalog-route";

export function OPTIONS() {
  return publicIssueCatalogOptions();
}

export async function GET(request: NextRequest) {
  return publicIssueCatalogGet(request);
}
