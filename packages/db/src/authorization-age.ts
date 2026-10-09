import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { AuthorizationTransaction } from './authorization';

type AgeInput = {
  readonly userId: string;
  readonly actorId: string;
  readonly accountRevision: number;
  readonly now: string;
};
type AgeFact =
  | { readonly state: 'unknown' }
  | {
      readonly state: 'known';
      readonly actorId: string;
      readonly band: 'under-13' | '13-15' | '16-17' | 'adult';
      readonly revision: number;
      readonly accountRevision: number;
      readonly validUntil: string;
    };
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function isoDeadline(value: unknown) {
  if (!(value instanceof Date)) return value;
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}
function knownBand(
  value: unknown,
): value is Extract<AgeFact, { state: 'known' }>['band'] {
  return (
    value === 'under-13' ||
    value === '13-15' ||
    value === '16-17' ||
    value === 'adult'
  );
}
function checkedInstant(input: AgeInput) {
  if (typeof input.now !== 'string') throw createAppError('VALIDATION');
  const instant = new Date(input.now);
  const validTime =
    Number.isFinite(instant.getTime()) && instant.toISOString() === input.now;
  if (
    !idSchema.safeParse(input.userId).success ||
    !idSchema.safeParse(input.actorId).success ||
    !positive(input.accountRevision) ||
    !validTime
  )
    throw createAppError('VALIDATION');
  return instant;
}
function projection(
  row: Record<string, unknown>,
  input: AgeInput,
  instant: Date,
): AgeFact {
  const deadline = new Date(instant);
  deadline.setUTCDate(1);
  deadline.setUTCMonth(deadline.getUTCMonth() + 1);
  deadline.setUTCHours(0, 0, 0, 0);
  const validUntil = isoDeadline(row.validUntil);
  const band = row.band;
  if (
    !knownBand(band) ||
    row.actorId !== input.actorId ||
    row.accountRevision !== input.accountRevision ||
    !positive(row.revision) ||
    validUntil !== deadline.toISOString()
  )
    return { state: 'unknown' };
  return {
    state: 'known',
    actorId: input.actorId,
    band,
    revision: row.revision,
    accountRevision: input.accountRevision,
    validUntil,
  };
}
/** Same transaction and canonical user fence; no raw birth data or profile leaves PostgreSQL. */
export async function loadAuthorizationAgeFact(
  tx: AuthorizationTransaction,
  input: AgeInput,
): Promise<AgeFact> {
  const instant = checkedInstant(input);
  const rows =
    await tx.execute(sql`select * from public.daisy_authorization_age(
    ${input.userId}::text, ${input.actorId}::text, ${input.accountRevision}::integer, ${input.now}::timestamptz
  )`);
  if (rows.length !== 1 || typeof rows[0] !== 'object' || rows[0] === null)
    return { state: 'unknown' };
  return projection(rows[0] as Record<string, unknown>, input, instant);
}
