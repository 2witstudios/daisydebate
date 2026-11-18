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

/**
 * The one formatter for a ladder's full name where a page outside the lobbies
 * names one (Watch, Recordings, league lobbies): its division, then its style,
 * as "Open – Freestyle". Inside a lobby a page names the style alone (ADR 0156).
 */
export const ladderLabel = (ladder: Ladder): string =>
  `${divisionLabels[ladder.division]} – ${styleLabels[ladder.style]}`;
