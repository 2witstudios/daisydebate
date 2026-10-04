import type { Entry } from './entry';
import { formatDate, formatDay, formatWhen } from './dates';
import { tournamentRoutes } from './routes';
import { inertActions, type InertActionId } from './actions';
import {
  statusOf,
  type RatingBand,
  type RulesKind,
  type Structure,
  type Tournament,
  type TournamentStatus,
} from './tournament';

export const structureLabel = (structure: Structure): string =>
  structure === 'single-elimination' ? 'Single elimination' : 'Round robin';

export const rulesLabel = (rules: RulesKind): string =>
  rules === 'standard' ? 'Standard rules' : 'Custom rules';

const statuses: Readonly<Record<TournamentStatus, string>> = {
  open: 'Registration open',
  'not-open': 'Not open yet',
  full: 'Full, waitlist',
  closed: 'Registration closed',
  live: 'In progress',
  done: 'Completed',
};

export const statusLabel = (status: TournamentStatus): string =>
  statuses[status];

export const slotsLabel = (tournament: Tournament): string =>
  `${tournament.entered} of ${tournament.places}`;

/** Places taken, 0 to 100, for the fill bar. */
export const fillPercent = (tournament: Tournament): number =>
  Math.min(100, Math.round((100 * tournament.entered) / tournament.places));

export const bandLabel = ({ min, max }: RatingBand): string => {
  if (min !== null && max !== null) return `${min} to ${max}`;
  if (min !== null) return `${min} and above`;
  if (max !== null) return `up to ${max}`;
  return 'any rating';
};

/** When the tournament happens, in the list's words. */
export function whenLabel(tournament: Tournament): string {
  if (tournament.progress) return tournament.progress.when;
  return statusOf(tournament) === 'done'
    ? formatDay(tournament.startsAt)
    : formatWhen(tournament.startsAt);
}

const day = (iso: string | null, prefix: string, fallback: string): string =>
  iso ? `${prefix} ${formatDay(iso)}` : fallback;

const metas: Readonly<Record<TournamentStatus, (t: Tournament) => string>> = {
  open: (t) =>
    day(t.registrationClosesAt, 'Registration closes', 'Registration open'),
  'not-open': (t) =>
    day(
      t.registrationOpensAt,
      'Registration opens',
      'Registration not open yet',
    ),
  full: (t) => `Full, ${t.waitlisted} on the waitlist`,
  closed: (t) =>
    t.registrationClosesAt
      ? `Registration closed ${formatDate(t.registrationClosesAt)}`
      : 'Registration closed',
  live: (t) => t.progress?.note ?? 'In progress',
  done: (t) =>
    t.outcome ? `${t.outcome.label}: @${t.outcome.handle}` : 'Completed',
};

/** The second line of a list row. */
export const metaLabel = (tournament: Tournament): string =>
  metas[statusOf(tournament)](tournament);

/** The viewer's own line on a row, or null. */
export function mineLabel(entry: Entry | null): string | null {
  if (entry === null) return null;
  if (entry.kind === 'registered') return 'You are registered';
  if (entry.kind === 'waitlisted')
    return `You are waitlisted, position ${entry.position}`;
  return `You are in: ${entry.stage}`;
}

export type RowAction =
  | {
      readonly kind: 'link';
      readonly label: string;
      readonly href: string;
      readonly primary: boolean;
    }
  | {
      readonly kind: 'inert';
      readonly label: string;
      readonly id: InertActionId;
    };

const link = (label: string, href: string, primary = false): RowAction => ({
  kind: 'link',
  label,
  href,
  primary,
});

/** The one action a row offers. Register goes to the guarded entry flow. */
export function rowAction(
  tournament: Tournament,
  entry: Entry | null,
): RowAction {
  const { id } = tournament;
  switch (statusOf(tournament)) {
    case 'open':
      return entry
        ? link('View', tournamentRoutes.detail(id))
        : link('Register', tournamentRoutes.enter(id), true);
    case 'full':
      return entry
        ? link('View', tournamentRoutes.detail(id))
        : link('Join waitlist', tournamentRoutes.enter(id), true);
    case 'not-open':
      return { kind: 'inert', id: 'remind', label: inertActions.remind };
    case 'closed':
      return link('View', tournamentRoutes.detail(id));
    case 'live':
      return entry
        ? link('Open my event', tournamentRoutes.myEvent(id), true)
        : link('Follow', tournamentRoutes.bracket(id));
    case 'done':
      return link('Results', tournamentRoutes.results(id));
  }
}
