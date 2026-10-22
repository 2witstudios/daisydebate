import { createAppError } from '@daisy/errors';
/** Preserve PostgreSQL microseconds when comparing with integer-ms engine boundaries. */
export function attendanceReceiptTime(iso: string): number {
  const whole = Date.parse(iso);
  const fraction = /\.(\d+)Z$/.exec(iso)?.[1] ?? '';
  if (!Number.isFinite(whole))
    throw createAppError('INVARIANT', 'Invalid persisted attendance receipt');
  return whole + (fraction.length > 3 ? Number(`0.${fraction.slice(3)}`) : 0);
}
