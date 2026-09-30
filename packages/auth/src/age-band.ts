import { createAppError } from '@daisy/errors';

export type AgeBand = 'under-13' | '13-15' | '16-17' | 'adult';

/** `YYYY-MM`, year 1000-9999, month 01-12. */
const BIRTH_MONTH_SHAPE = /^([1-9]\d{3})-(0[1-9]|1[0-2])$/;

/**
 * Buckets a person by age from their birth month (`YYYY-MM`) and an injected
 * clock. Only the month is known, so a person is a given age for the whole
 * month they turn it. Malformed input, an invalid `now`, or a birth month
 * after `now` throws a VALIDATION error.
 */
export function ageBand(birthMonth: unknown, now: Date): AgeBand {
  const match =
    typeof birthMonth === 'string' ? BIRTH_MONTH_SHAPE.exec(birthMonth) : null;
  if (!match || Number.isNaN(now.getTime())) throw createAppError('VALIDATION');
  const birthIndex = Number(match[1]) * 12 + Number(match[2]) - 1;
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const months = nowIndex - birthIndex;
  if (months < 0) throw createAppError('VALIDATION');
  if (months < 13 * 12) return 'under-13';
  if (months < 16 * 12) return '13-15';
  if (months < 18 * 12) return '16-17';
  return 'adult';
}
