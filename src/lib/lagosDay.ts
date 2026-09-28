// "Today" for this product means today in Nigeria (WAT, UTC+1, no daylight
// saving), whatever timezone the server runs in.
const WAT_OFFSET_MS = 60 * 60 * 1000;

export function startOfLagosDay(now: Date = new Date()): Date {
  const lagos = new Date(now.getTime() + WAT_OFFSET_MS);
  const midnightAsUtc = Date.UTC(
    lagos.getUTCFullYear(),
    lagos.getUTCMonth(),
    lagos.getUTCDate(),
  );
  return new Date(midnightAsUtc - WAT_OFFSET_MS);
}

export function isTodayInLagos(date: Date, now: Date = new Date()): boolean {
  return date >= startOfLagosDay(now);
}
