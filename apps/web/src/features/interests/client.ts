import type {
  ApiErrorBody,
  InterestCardCode,
  InterestCardRegistry,
  InterestProfile,
} from "@/lib/contracts";

async function body<T>(response: Response) {
  const result = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const error = result as ApiErrorBody;
    throw new Error(error.message || "관심사 요청을 처리하지 못했습니다.");
  }
  return result as T;
}

export async function loadInterestCardRegistry() {
  return body<InterestCardRegistry>(
    await fetch("/api/interests/cards", {
      cache: "no-store",
      headers: { accept: "application/json" },
    }),
  );
}

export async function loadInterestProfile() {
  return body<InterestProfile>(
    await fetch("/api/interest-profile", {
      cache: "no-store",
      headers: { accept: "application/json" },
    }),
  );
}

export async function saveInterestProfile(command: {
  selectedCardCodes: InterestCardCode[];
  onboardingState: "COMPLETED" | "SKIPPED";
}) {
  return body<InterestProfile>(
    await fetch("/api/interest-profile", {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(command),
    }),
  );
}

export async function resetInterestProfile() {
  return body<InterestProfile>(
    await fetch("/api/interest-profile/reset", {
      method: "POST",
      headers: { accept: "application/json" },
    }),
  );
}

export async function mergeGuestInterestProfile(command: {
  anonymousSubjectId: string;
  selectedCardCodes: InterestCardCode[];
}) {
  return body<InterestProfile>(
    await fetch("/api/interest-profile/merge", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(command),
    }),
  );
}
