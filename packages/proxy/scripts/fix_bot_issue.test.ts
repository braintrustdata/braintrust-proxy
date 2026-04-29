import { describe, expect, it } from "vitest";
import {
  isDateWithinDays,
  UPCOMING_DEPRECATION_WINDOW_DAYS,
} from "./fix_bot_issue";

describe("fix_bot_issue", () => {
  it("treats deprecation dates inside the default window as actionable skips", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    expect(
      isDateWithinDays("2026-03-15", UPCOMING_DEPRECATION_WINDOW_DAYS, now),
    ).toBe(true);
    expect(
      isDateWithinDays("2026-05-01", UPCOMING_DEPRECATION_WINDOW_DAYS, now),
    ).toBe(false);
  });
});
