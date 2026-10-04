import { shiftMinutes, formatTime } from './dates';
import type { Structure, Tournament } from './tournament';

/** Minutes between the starts of consecutive rounds (a sample constant). */
const ROUND_SPACING_MINUTES = 90;
/** Minutes after the start an absent debater can be recorded as a forfeit (sample). */
export const FORFEIT_GRACE_MINUTES = 10;
/** Minutes before a round that check-in opens (a sample constant). */
export const CHECK_IN_MINUTES = 10;
/** Minutes after registration closes that the bracket posts (sample). */
const BRACKET_DELAY_MINUTES = 60;

/** "Final", "Semifinals", "Quarterfinals", "Round of 16" for a bracket. */
const eliminationLabel = (remaining: number): string => {
  if (remaining === 2) return 'Final';
  if (remaining === 4) return 'Semifinals';
  if (remaining === 8) return 'Quarterfinals';
  return `Round of ${remaining}`;
};

/** The round names of a tournament, first round first. */
export function roundLabels(structure: Structure, places: number): string[] {
  if (structure === 'round-robin') {
    const rounds = places % 2 === 0 ? places - 1 : places;
    return Array.from({ length: rounds }, (_, i) => `Round ${i + 1}`);
  }
  const rounds = Math.round(Math.log2(places));
  return Array.from({ length: rounds }, (_, i) =>
    eliminationLabel(places / 2 ** i),
  );
}

export type ScheduleItem = {
  readonly label: string;
  readonly note: string;
  /** UTC ISO timestamp. */
  readonly at: string;
};

/** Registration close, the bracket post and every round, in order. */
export function scheduleFor(tournament: Tournament): ScheduleItem[] {
  const { registrationClosesAt, startsAt } = tournament;
  const rounds = roundLabels(tournament.structure, tournament.places);
  const items: ScheduleItem[] = [];
  if (registrationClosesAt) {
    items.push({
      label: 'Registration closes',
      note: 'Seeds are set by rating',
      at: registrationClosesAt,
    });
    items.push({
      label:
        tournament.structure === 'round-robin'
          ? 'Pairings posted'
          : 'Bracket published',
      note: '',
      at: shiftMinutes(registrationClosesAt, BRACKET_DELAY_MINUTES),
    });
  }
  rounds.forEach((label, index) => {
    const at = shiftMinutes(startsAt, index * ROUND_SPACING_MINUTES);
    items.push({
      label,
      note:
        index === 0
          ? `Check-in opens ${formatTime(shiftMinutes(at, -CHECK_IN_MINUTES))}`
          : '',
      at,
    });
  });
  return items;
}
