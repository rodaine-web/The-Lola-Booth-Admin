function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function offsetMs(timeZone, date) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstPass = new Date(utcGuess.getTime() - offsetMs(timeZone, utcGuess));
  const secondPass = new Date(utcGuess.getTime() - offsetMs(timeZone, firstPass));
  return secondPass;
}

export function addDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function startOfLocalDay(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function range(startParts, endParts, timeZone) {
  return {
    start: zonedTimeToUtc(startParts, timeZone),
    end: zonedTimeToUtc(endParts, timeZone),
    timeZone
  };
}

function previousRange(current) {
  const duration = current.end.getTime() - current.start.getTime();
  return {
    start: new Date(current.start.getTime() - duration),
    end: new Date(current.start.getTime()),
    timeZone: current.timeZone
  };
}

export function getBusinessDateRanges({ now = new Date(), timeZone = "America/Chicago", weekStart = 1 } = {}) {
  const todayParts = startOfLocalDay(now, timeZone);
  const today = range(todayParts, addDays(todayParts, 1), timeZone);
  const zonedNow = zonedParts(now, timeZone);
  const currentDay = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)).getUTCDay();
  const normalizedWeekStart = Number.isInteger(weekStart) ? weekStart : 1;
  const weekOffset = (currentDay - normalizedWeekStart + 7) % 7;
  const weekStartParts = addDays(todayParts, -weekOffset);
  const week = range(weekStartParts, addDays(weekStartParts, 7), timeZone);
  const mtdStart = { year: todayParts.year, month: todayParts.month, day: 1 };
  const mtd = range(mtdStart, addDays(todayParts, 1), timeZone);
  const ytdStart = { year: todayParts.year, month: 1, day: 1 };
  const ytd = range(ytdStart, addDays(todayParts, 1), timeZone);
  const priorMonth = todayParts.month === 1 ? { year: todayParts.year - 1, month: 12 } : { year: todayParts.year, month: todayParts.month - 1 };
  const priorMtdEndDay = Math.min(zonedNow.day, new Date(Date.UTC(priorMonth.year, priorMonth.month, 0)).getUTCDate());
  const priorYtdEndYear = todayParts.year - 1;

  return {
    today,
    week,
    mtd,
    ytd,
    comparisons: {
      previousDay: previousRange(today),
      previousWeek: previousRange(week),
      equivalentPriorMonthPeriod: range(
        { year: priorMonth.year, month: priorMonth.month, day: 1 },
        addDays({ year: priorMonth.year, month: priorMonth.month, day: priorMtdEndDay }, 1),
        timeZone
      ),
      sameYtdPeriodPreviousYear: range(
        { year: priorYtdEndYear, month: 1, day: 1 },
        { year: priorYtdEndYear, month: todayParts.month, day: todayParts.day + 1 },
        timeZone
      )
    }
  };
}

export function toSqlRange(rangeValue) {
  return { start: rangeValue.start.toISOString(), end: rangeValue.end.toISOString() };
}
