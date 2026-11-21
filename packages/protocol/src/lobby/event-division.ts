import { instantMs } from '@daisy/clock';
import {
  divisionOfAgeBand,
  type AgeBand,
  type RatingDivision,
} from '../ladder';

/**
 * An event's division (decision 79, ADR 0149 PYL-16): a hosted tournament
 * declares Open or Youth, and an entrant's age is taken on its first day, so
 * someone who turns 18 before it starts debates in Open.
 */
export type DivisionRefusal =
  'over-youth-age' | 'under-open-age' | 'no-age-record';
export type DivisionAdmission =
  | { readonly kind: 'admitted' }
  | { readonly kind: 'refused'; readonly reason: DivisionRefusal };

/** Whether an entrant aged `bandOnFirstDay` on the event's first day may enter it. */
export function divisionAdmission(
  bandOnFirstDay: AgeBand | null,
  division: RatingDivision,
): DivisionAdmission {
  const own = divisionOfAgeBand(bandOnFirstDay);
  if (own === null) return { kind: 'refused', reason: 'no-age-record' };
  if (own === division) return { kind: 'admitted' };
  return {
    kind: 'refused',
    reason: division === 'youth' ? 'over-youth-age' : 'under-open-age',
  };
}

/** The tournament's first day: its earliest scheduled slot, or now while none is. */
export const tournamentFirstDay = (
  slotStarts: readonly string[],
  now: string,
): string =>
  slotStarts.reduce(
    (earliest, start) =>
      instantMs(start) < instantMs(earliest) ? start : earliest,
    slotStarts[0] ?? now,
  );

/**
 * Why an entry was refused, as the entrant reads it (RTabEntryRefused). Its
 * reader is the public tournament page's entry panel (ISSUE-1472).
 * `no-age-record` is the domain's `age-band` refusal, which that panel shows
 * in these words too.
 */
export function divisionRefusalWords(
  reason: DivisionRefusal,
  tournament: string,
  firstDay: string,
): string {
  switch (reason) {
    case 'over-youth-age':
      return `${tournament} is Youth – Freestyle, for debaters under 18 on ${firstDay}. You’ll be 18, so you debate in Open.`;
    case 'under-open-age':
      return `${tournament} is Open – Freestyle, for debaters 18 and over on ${firstDay}. You debate in Youth until then.`;
    case 'no-age-record':
      return `${tournament} needs your age to place you in a division. Add it in your account settings.`;
  }
}
