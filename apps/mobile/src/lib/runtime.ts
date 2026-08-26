import { createGuestSubjectManager } from "./guest-subject";
import { createMemberSessionManager } from "./member-session";
import { createMobileApiClient } from "./mobile-api";
import { createNativeAuthManager } from "./native-auth";
import { subjectStorage } from "./secure-subject-storage";

export const mobileApi = createMobileApiClient();
export const guestSubjects = createGuestSubjectManager(subjectStorage, mobileApi);
export const memberSessions = createMemberSessionManager(subjectStorage, mobileApi);
export const nativeAuth = createNativeAuthManager(subjectStorage, mobileApi);
