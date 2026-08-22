export const INTEREST_TAXONOMY_VERSION = "interest_cards_v1";

export const INTEREST_CARD_CODES = [
  "DAILY_LIFE",
  "FOOD",
  "TRAVEL",
  "RELATIONSHIP",
  "WORK",
  "ECONOMY_CONSUMPTION",
  "TECH",
  "GAME",
  "MOVIE_DRAMA",
  "MUSIC_CONTENT",
  "SPORTS",
  "EDUCATION",
  "SOCIETY",
  "HOBBY",
] as const;

export type InterestCardCode = (typeof INTEREST_CARD_CODES)[number];
export type InterestOnboardingState = "NOT_STARTED" | "COMPLETED" | "SKIPPED" | "RESET";

export type InterestCard = {
  code: InterestCardCode;
  label: string;
  categoryCodes: string[];
  topicCodes: string[];
};

export type InterestSubjectContext = {
  anonymousSubjectId?: string;
  sessionToken?: string;
};

export type InterestMergeCandidate = {
  anonymousSubjectId: string;
  guestCardCodes: InterestCardCode[];
  suggestedCardCodes: InterestCardCode[];
};

export type InterestProfileView = {
  taxonomyVersion: typeof INTEREST_TAXONOMY_VERSION;
  onboardingState: InterestOnboardingState;
  selectedCardCodes: InterestCardCode[];
  canSkip: boolean;
  profileVersion: number;
  mergeCandidate: InterestMergeCandidate | null;
};

export type SaveInterestProfileCommand = InterestSubjectContext & {
  selectedCardCodes: InterestCardCode[];
  onboardingState: "COMPLETED" | "SKIPPED";
};

export type MergeInterestProfileCommand = InterestSubjectContext & {
  anonymousSubjectId: string;
  selectedCardCodes: InterestCardCode[];
};

export interface InterestProfileService {
  listCards(): InterestCard[];
  getProfile(context: InterestSubjectContext): Promise<InterestProfileView>;
  saveProfile(command: SaveInterestProfileCommand): Promise<InterestProfileView>;
  resetProfile(context: InterestSubjectContext): Promise<InterestProfileView>;
  mergeGuestProfile(command: MergeInterestProfileCommand): Promise<InterestProfileView>;
}
