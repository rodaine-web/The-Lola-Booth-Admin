/** Calendar cells use date-only UTC arithmetic so the operator's timezone cannot shift a day. */
export function calendarCells(date, view, range) {
  const anchor = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return [];
  if (view === "day") return [date];
  const start = view === "month"
    ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12))
    : new Date(range?.startDate ? `${String(range.startDate).slice(0, 10)}T12:00:00Z` : anchor);
  if (view === "month" || !range?.startDate) start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = view === "month"
    ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12))
    : new Date(start);
  if (view === "month") end.setUTCDate(end.getUTCDate() + 6 - end.getUTCDay());
  else end.setUTCDate(end.getUTCDate() + 6);
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) days.push(cursor.toISOString().slice(0, 10));
  return days;
}
