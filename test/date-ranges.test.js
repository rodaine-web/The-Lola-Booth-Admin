import assert from "node:assert/strict";
import test from "node:test";
import { getBusinessDateRanges } from "../server/src/utils/date-ranges.js";

test("business ranges handle month boundaries", () => {
  const ranges = getBusinessDateRanges({
    now: new Date("2026-03-01T18:00:00Z"),
    timeZone: "America/Chicago"
  });
  assert.equal(ranges.mtd.start.toISOString(), "2026-03-01T06:00:00.000Z");
  assert.equal(ranges.comparisons.equivalentPriorMonthPeriod.start.toISOString(), "2026-02-01T06:00:00.000Z");
});

test("business ranges handle year boundaries", () => {
  const ranges = getBusinessDateRanges({
    now: new Date("2026-01-01T18:00:00Z"),
    timeZone: "America/Chicago"
  });
  assert.equal(ranges.ytd.start.toISOString(), "2026-01-01T06:00:00.000Z");
  assert.equal(ranges.comparisons.sameYtdPeriodPreviousYear.start.toISOString(), "2025-01-01T06:00:00.000Z");
});

test("business ranges account for daylight saving time", () => {
  const ranges = getBusinessDateRanges({
    now: new Date("2026-03-08T18:00:00Z"),
    timeZone: "America/Chicago"
  });
  const hours = (ranges.today.end.getTime() - ranges.today.start.getTime()) / 3600000;
  assert.equal(hours, 23);
});

test("empty dataset range inputs still return concrete ranges", () => {
  const ranges = getBusinessDateRanges({
    now: new Date("2026-09-12T14:00:00Z"),
    timeZone: "America/Chicago"
  });
  assert.ok(ranges.today.start instanceof Date);
  assert.ok(ranges.today.end instanceof Date);
  assert.ok(ranges.today.end > ranges.today.start);
});
