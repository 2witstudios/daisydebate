import type { Ladder } from '@daisy/protocol';
import { divisionAudiences, ladderLabel } from '../ratings/ladder-labels';

/** The chosen ladder as the board names it above the table (ADR 0147). */
export type LadderName = {
  readonly ladder: Ladder;
  /** "Youth – Freestyle". */
  readonly label: string;
  /** "Members under 18 · 412 debaters". */
  readonly audience: string;
};

const debaterCount = (count: number): string =>
  `${count} ${count === 1 ? 'debater' : 'debaters'}`;

/** Names a ladder and who is on it, from its count of ranked debaters. */
export const ladderName = (ladder: Ladder, debaters: number): LadderName => ({
  ladder,
  label: ladderLabel(ladder),
  audience: `Members ${divisionAudiences[ladder.division].toLowerCase()} · ${debaterCount(debaters)}`,
});
