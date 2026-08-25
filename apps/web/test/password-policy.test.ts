import { describe, expect, it } from "vitest";

import { NEW_PASSWORD_POLICY_ERROR, newPasswordPolicyError } from "@/lib/password-policy";

describe("new password policy", () => {
  it("accepts only 8 to 15 characters with an ASCII special character", () => {
    expect(newPasswordPolicyError("Abcdef!1")).toBeNull();
    expect(newPasswordPolicyError("12345678901234!")).toBeNull();
    expect(newPasswordPolicyError("Abcd!12")).toBe(NEW_PASSWORD_POLICY_ERROR);
    expect(newPasswordPolicyError("Abcdefg1")).toBe(NEW_PASSWORD_POLICY_ERROR);
    expect(newPasswordPolicyError("123456789012345!")).toBe(NEW_PASSWORD_POLICY_ERROR);
  });
});
