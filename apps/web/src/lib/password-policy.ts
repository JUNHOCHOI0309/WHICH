export const NEW_PASSWORD_MIN_LENGTH = 8;
export const NEW_PASSWORD_MAX_LENGTH = 15;
export const NEW_PASSWORD_REQUIREMENT = "8~15자, 특수문자 1개 이상 필수";
export const NEW_PASSWORD_POLICY_ERROR =
  "비밀번호는 8~15자이며 특수문자를 1개 이상 포함해야 합니다.";

const ASCII_SPECIAL_CHARACTER = /[!-/:-@[-`{-~]/;

export function newPasswordPolicyError(value: string) {
  if (
    value.length < NEW_PASSWORD_MIN_LENGTH ||
    value.length > NEW_PASSWORD_MAX_LENGTH ||
    !ASCII_SPECIAL_CHARACTER.test(value)
  ) {
    return NEW_PASSWORD_POLICY_ERROR;
  }
  return null;
}
