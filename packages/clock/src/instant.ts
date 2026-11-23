import type { Clock } from './index';

const zonedInstant =
  /^(?<year>\d{4}|[+-]\d{6})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Read a zoned ISO instant at millisecond precision, or refuse it. */
export function tryInstantMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const date = zonedInstant.exec(value)?.groups;
  if (date === undefined) return undefined;

  const year = Number(date.year);
  const month = Number(date.month);
  const day = Number(date.day);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay =
    month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (day > lastDay) return undefined;

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

/**
 * Read an instant only in its canonical UTC form, exactly as
 * `toISOString()` writes it (`2026-11-22T10:00:00.000Z`), or refuse it.
 */
export function tryCanonicalInstantMs(value: unknown): number | undefined {
  const milliseconds = tryInstantMs(value);
  return milliseconds !== undefined &&
    new Date(milliseconds).toISOString() === value
    ? milliseconds
    : undefined;
}

/** Require a zoned ISO instant and return its epoch milliseconds. */
export function instantMs(value: string): number {
  const milliseconds = tryInstantMs(value);
  if (milliseconds === undefined)
    throw new RangeError('Expected a zoned ISO instant');
  return milliseconds;
}

/** Read the injected clock as epoch milliseconds. */
export const nowMs = (clock: Clock): number => instantMs(clock.now());

/** Add whole milliseconds and return a UTC ISO instant. */
export function addMs(instant: string, durationMs: number): string {
  if (!Number.isSafeInteger(durationMs))
    throw new RangeError('Expected a whole millisecond duration');
  return new Date(instantMs(instant) + durationMs).toISOString();
}

/**
 * Add whole milliseconds to a zoned instant and return the UTC ISO instant,
 * or undefined when the input is not an instant, the duration is not whole,
 * or the sum falls outside the range a timestamp can hold.
 */
export function tryAddMs(
  instant: string,
  durationMs: number,
): string | undefined {
  const start = tryInstantMs(instant);
  if (start === undefined || !Number.isSafeInteger(durationMs))
    return undefined;
  const sum = start + durationMs;
  return Math.abs(sum) <= 8.64e15 ? new Date(sum).toISOString() : undefined;
}

const instantDifference = (left: unknown, right: unknown) => {
  const a = tryInstantMs(left);
  const b = tryInstantMs(right);
  return a === undefined || b === undefined ? undefined : a - b;
};

/** Whether two valid instants are strictly ordered. */
export function isInstantBefore(left: unknown, right: unknown): boolean {
  const difference = instantDifference(left, right);
  return difference !== undefined && difference < 0;
}

/** Whether two valid instants are ordered or equal. */
export function isInstantAtOrBefore(left: unknown, right: unknown): boolean {
  const difference = instantDifference(left, right);
  return difference !== undefined && difference <= 0;
}
