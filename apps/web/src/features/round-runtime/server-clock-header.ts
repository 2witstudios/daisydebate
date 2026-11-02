import type { Clock } from '@daisy/clock';

/** The wire contract: nonnegative decimal integer milliseconds. */
const SERVER_CLOCK_HEADER = 'x-server-now-ms';
export const MAX_SERVER_INSTANT_MS = 8.64e15;

/** Stamped by an authorized read from the handler's injected clock. */
export const serverClockHeaders = (clock: Clock) => ({
  [SERVER_CLOCK_HEADER]: String(Date.parse(clock.now())),
});

export const serverInstantOf = (headers: Headers): number | null => {
  const decimal = headers.get(SERVER_CLOCK_HEADER)?.trim();
  if (!decimal || !/^\d+$/.test(decimal)) return null;
  const milliseconds = Number(decimal);
  return Number.isSafeInteger(milliseconds) &&
    milliseconds <= MAX_SERVER_INSTANT_MS
    ? milliseconds
    : null;
};
