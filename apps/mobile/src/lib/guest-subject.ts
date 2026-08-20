import type { MobileApiClient } from "./mobile-api";

const guestSubjectKey = "which.mobile.guest-subject.v1";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SubjectStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function validGuestSubject(value: string | null | undefined) {
  return value && uuidPattern.test(value) ? value : null;
}

export function createGuestSubjectManager(storage: SubjectStorage, api: MobileApiClient) {
  async function createAndStore() {
    const created = await api.createGuestSubject();
    const subjectId = validGuestSubject(created.anonymousSubjectId);
    if (!subjectId) throw new Error("Guest Subject 응답이 올바르지 않습니다.");
    await storage.setItem(guestSubjectKey, subjectId);
    return subjectId;
  }

  return {
    async getOrCreate() {
      const existing = validGuestSubject(await storage.getItem(guestSubjectKey));
      return existing ?? createAndStore();
    },
    async rotate() {
      await storage.removeItem(guestSubjectKey);
      return createAndStore();
    },
  };
}
