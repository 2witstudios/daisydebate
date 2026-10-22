import { createAppError } from '@daisy/errors';
/** Preserve PostgreSQL microseconds when comparing with integer-ms engine boundaries. */
export function attendanceReceiptTime(iso: string): number {
  const whole = Date.parse(iso);
  const fraction = /\.(\d+)Z$/.exec(iso)?.[1] ?? '';
  if (!Number.isFinite(whole))
    throw createAppError('INVARIANT', 'Invalid persisted attendance receipt');
  return whole + (fraction.length > 3 ? Number(`0.${fraction.slice(3)}`) : 0);
}

/** Effective deadlines may inherit a native PG microsecond outage boundary. */
export function attendanceTimestamp(atMs: number): string {
  const micros = Math.round(atMs * 1000);
  if (!Number.isSafeInteger(micros))
    throw createAppError('INVARIANT', 'Invalid attendance instant');
  const milliseconds = Math.floor(micros / 1000);
  const remainder = micros - milliseconds * 1000;
  return new Date(milliseconds)
    .toISOString()
    .replace(/Z$/, `${String(remainder).padStart(3, '0')}Z`);
}
