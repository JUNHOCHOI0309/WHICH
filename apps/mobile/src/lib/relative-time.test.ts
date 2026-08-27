import { describe, expect, it } from "vitest";

import { relativeTimeLabel } from "./relative-time";

describe("relativeTimeLabel", () => {
  const now = new Date("2026-08-27T12:00:00.000Z").getTime();

  it.each([
    ["2026-08-27T11:59:40.000Z", "방금 전"],
    ["2026-08-27T11:45:00.000Z", "15분 전"],
    ["2026-08-27T09:00:00.000Z", "3시간 전"],
    ["2026-08-24T12:00:00.000Z", "3일 전"],
    ["2026-06-27T12:00:00.000Z", "2개월 전"],
    ["2024-08-27T12:00:00.000Z", "2년 전"],
  ])("formats %s as %s", (value, expected) => {
    expect(relativeTimeLabel(value, now)).toBe(expected);
  });
});
