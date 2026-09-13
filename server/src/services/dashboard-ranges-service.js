import { query } from "../db/pool.js";
import { getBusinessDateRanges, toSqlRange } from "../utils/date-ranges.js";

export async function getDashboardRangeFoundation(now = new Date()) {
  const settings = await query("SELECT timezone, business_week_start FROM business_settings LIMIT 1");
  const timeZone = settings.rows[0]?.timezone || "America/Chicago";
  const ranges = getBusinessDateRanges({ now, timeZone, weekStart: Number(settings.rows[0]?.business_week_start ?? 1) });

  return {
    timeZone,
    today: toSqlRange(ranges.today),
    week: toSqlRange(ranges.week),
    mtd: toSqlRange(ranges.mtd),
    ytd: toSqlRange(ranges.ytd),
    comparisons: Object.fromEntries(Object.entries(ranges.comparisons).map(([key, value]) => [key, toSqlRange(value)]))
  };
}
