/**
 * Read models for the Tournaments screens. A tournament is an organized,
 * unrated event made of Ranked debates (rooms and debates: ADR 0049). These
 * are the shapes the list and detail reads fill, not stored rows.
 */

export const structures = ['single-elimination', 'round-robin'] as const;
export type Structure = (typeof structures)[number];

export const ruleKinds = ['standard', 'custom'] as const;
export type RulesKind = (typeof ruleKinds)[number];

/** Where a tournament is in its life; everything user-facing derives from it. */
export type Lifecycle =
  | 'announced'
  | 'registration'
  | 'registration-closed'
  | 'in-progress'
  | 'completed';

/** What the list badge says. Full is registration with no places left. */
export type TournamentStatus =
  'open' | 'not-open' | 'full' | 'closed' | 'live' | 'done';

export const tournamentTabs = ['open', 'upcoming', 'live', 'past'] as const;
export type TournamentTab = (typeof tournamentTabs)[number];

/** Accepted ratings; a `null` end is unbounded. */
export type RatingBand = {
  readonly min: number | null;
  readonly max: number | null;
};

export type Tournament = {
  readonly id: string;
  readonly name: string;
  readonly structure: Structure;
  readonly rules: RulesKind;
  readonly places: number;
  readonly entered: number;
  readonly waitlisted: number;
  readonly lifecycle: Lifecycle;
  /** UTC ISO timestamps. */
  readonly startsAt: string;
  readonly registrationOpensAt: string | null;
  readonly registrationClosesAt: string | null;
  readonly band: RatingBand;
  readonly organizer: string;
  readonly featured: boolean;
  /** In progress only: sample wording for the current round. */
  readonly progress: { readonly when: string; readonly note: string } | null;
  /** Completed only. */
  readonly outcome: {
    readonly label: 'Champion' | 'Winner';
    readonly handle: string;
  } | null;
};

export const isFull = (tournament: Tournament): boolean =>
  tournament.entered >= tournament.places;

export function statusOf(tournament: Tournament): TournamentStatus {
  switch (tournament.lifecycle) {
    case 'announced':
      return 'not-open';
    case 'registration':
      return isFull(tournament) ? 'full' : 'open';
    case 'registration-closed':
      return 'closed';
    case 'in-progress':
      return 'live';
    case 'completed':
      return 'done';
  }
}

const tabs: Readonly<Record<TournamentStatus, TournamentTab>> = {
  open: 'open',
  'not-open': 'upcoming',
  full: 'upcoming',
  closed: 'upcoming',
  live: 'live',
  done: 'past',
};

export const tabOf = (tournament: Tournament): TournamentTab =>
  tabs[statusOf(tournament)];

export const bandAccepts = (band: RatingBand, rating: number): boolean =>
  (band.min === null || rating >= band.min) &&
  (band.max === null || rating <= band.max);
