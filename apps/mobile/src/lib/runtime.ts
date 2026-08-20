import { createGuestSubjectManager } from "./guest-subject";
import { createMobileApiClient } from "./mobile-api";
import { subjectStorage } from "./secure-subject-storage";

export const mobileApi = createMobileApiClient();
export const guestSubjects = createGuestSubjectManager(subjectStorage, mobileApi);
