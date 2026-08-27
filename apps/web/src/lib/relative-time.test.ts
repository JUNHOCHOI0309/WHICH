import { describe, expect, it } from "vitest";

import { relativeTimeLabel } from "./relative-time";

describe("relativeTimeLabel", () => {
  const now = new Date("2026-08-27T12:00:00.000Z").getTime();

  it("formats recent and older comment timestamps", () => {
    expect(relativeTimeLabel("2026-08-27T11:52:00.000Z", now)).toBe("8분 전");
    expect(relativeTimeLabel("2026-08-25T12:00:00.000Z", now)).toBe("2일 전");
    expect(relativeTimeLabel("2025-08-27T12:00:00.000Z", now)).toBe("1년 전");
  });
});
