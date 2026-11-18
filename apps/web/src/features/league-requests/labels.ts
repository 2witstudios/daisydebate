import type {
  LeagueRequestDivisions,
  LeagueRequestSchoolCount,
  LeagueRequestSeasonCount,
} from '@daisy/protocol/league-request';
import type { RatingStyle } from '@daisy/protocol';

/**
 * The words for each League request choice, in the canvas's order: the
 * form's options and the owner's email read the same labels.
 */
export const schoolCountLabels: Readonly<
  Record<LeagueRequestSchoolCount, string>
> = {
  'under-10': 'Under 10',
  '10-25': '10 to 25',
  '26-50': '26 to 50',
  'over-50': 'More than 50',
};

export const seasonCountLabels: Readonly<
  Record<LeagueRequestSeasonCount, string>
> = {
  '1': '1',
  '2': '2',
  '3-plus': '3 or more',
};

export const styleLabels: Readonly<Record<RatingStyle, string>> = {
  freestyle: 'Freestyle',
};

export const divisionsLabels: Readonly<Record<LeagueRequestDivisions, string>> =
  {
    youth: 'Youth',
    open: 'Open',
    'youth-and-open': 'Youth and Open',
  };
