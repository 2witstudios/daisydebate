import type { Ladder, RatingDivision, RatingStyle } from '@daisy/protocol';

/** The name each rating style shows (ADR 0142). */
export const styleLabels: Readonly<Record<RatingStyle, string>> = {
  freestyle: 'Freestyle',
};

/** The name each ladder division shows (ADR 0147). */
export const divisionLabels: Readonly<Record<RatingDivision, string>> = {
  open: 'Open',
  youth: 'Youth',
};

/** Who may debate on each division, in the words a seat or filter shows. */
export const divisionAudiences: Readonly<Record<RatingDivision, string>> = {
  open: '18 and over',
  youth: 'Under 18',
};

/**
 * The one formatter for a ladder's name on a card, a badge, a menu or a rail:
 * its division, then its style, as "Open – Freestyle".
 */
export const ladderLabel = (ladder: Ladder): string =>
  `${divisionLabels[ladder.division]} – ${styleLabels[ladder.style]}`;
