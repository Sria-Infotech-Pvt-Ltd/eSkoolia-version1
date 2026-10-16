import { formatShare, remindSummaryText, shouldPoll, updatedText } from "@/components/library/console/consoleHelpers";

describe("console helpers", () => {
  it("formats a share as a whole percentage and clamps it", () => {
    expect(formatShare(0.7345)).toBe("73%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(1.4)).toBe("100%");
    expect(formatShare(-1)).toBe("0%");
    expect(formatShare(Number.NaN)).toBe("0%");
  });

  it("summarises a reminder run", () => {
    expect(remindSummaryText({ queued: 3, queued_ids: [1, 2, 3], skipped: [], remaining: 0 })).toBe("Queued 3 reminders.");
    expect(remindSummaryText({ queued: 1, queued_ids: [1], skipped: [], remaining: 0 })).toBe("Queued 1 reminder.");
    expect(
      remindSummaryText({
        queued: 2,
        queued_ids: [1, 2],
        skipped: [
          { issue: 3, reason: "already_sent" },
          { issue: 4, reason: "not_overdue" },
        ],
        remaining: 5,
      }),
    ).toBe("Queued 2 reminders. 1 already reminded today. 1 skipped. 5 more overdue: run it again to reach them.");
  });

  it("says so when there was nothing to remind", () => {
    expect(remindSummaryText({ queued: 0, queued_ids: [], skipped: [], remaining: 0 })).toMatch(/nothing to remind/i);
  });

  it("polls only while the tab is visible", () => {
    expect(shouldPoll("visible")).toBe(true);
    expect(shouldPoll("hidden")).toBe(false);
    expect(shouldPoll(undefined)).toBe(true);
  });

  it("describes how fresh the numbers are", () => {
    const now = Date.parse("2026-03-24T10:05:00Z");
    expect(updatedText("2026-03-24T10:04:40Z", now)).toBe("Updated just now");
    expect(updatedText("2026-03-24T10:01:00Z", now)).toBe("Updated 4 min ago");
    expect(updatedText(null, now)).toBe("");
    expect(updatedText("junk", now)).toBe("");
  });
});
