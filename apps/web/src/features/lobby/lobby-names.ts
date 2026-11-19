import type { RatingDivision } from '@daisy/protocol';

/** The two lobbies by name (ADR 0156): the one place "Youth" names a division. */
export const lobbyNames: Readonly<Record<RatingDivision, string>> = {
  open: 'Open lobby',
  youth: 'Youth lobby',
};
