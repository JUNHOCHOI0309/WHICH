export type MemberIdentityErrorCode =
  | "INVALID_CURSOR"
  | "HANDLE_INVALID"
  | "HANDLE_RESERVED"
  | "HANDLE_TAKEN"
  | "DEVELOPMENT_PROVIDER_DISABLED"
  | "GUEST_SUBJECT_NOT_FOUND"
  | "GUEST_ALREADY_LINKED"
  | "MEMBER_NOT_ACTIVE";

export class MemberIdentityError extends Error {
  constructor(
    public readonly code: MemberIdentityErrorCode,
    public readonly statusCode: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "MemberIdentityError";
  }
}
