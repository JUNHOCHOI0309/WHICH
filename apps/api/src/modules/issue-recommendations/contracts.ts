export type SetIssueRecommendationCommand = {
  issueId: string;
  sessionToken: string;
  active: boolean;
};

export type IssueRecommendationResult = {
  recommendation: {
    active: boolean;
    count: number;
  };
};

export interface IssueRecommendationService {
  set(command: SetIssueRecommendationCommand): Promise<IssueRecommendationResult>;
}
