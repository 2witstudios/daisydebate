import type { RatingDivision } from '@daisy/protocol/ladder';
import type { RatingStyle } from '@daisy/protocol/primitives';

/** The name each rating style shows (ADR 0142). */
export const styleLabels: Readonly<Record<RatingStyle, string>> = {
  freestyle: 'Freestyle',
};

/** The name each division shows, on the leaderboard's lobby switch only (ADR 0162). */
export const divisionLabels: Readonly<Record<RatingDivision, string>> = {
  open: 'Open',
  youth: 'Youth',
};
