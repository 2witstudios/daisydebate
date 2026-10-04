import { signInHref } from '../access/decision';
import type { InertActionId } from './actions';
import { formatTime, formatWhen, shiftMinutes } from './dates';
import type { TournamentView } from './get-tournament';
import type { RegistrationState } from './entry';
import { bandLabel, slotsLabel } from './labels';
import { tournamentRoutes } from './routes';
import { CHECK_IN_MINUTES } from './schedule';

export type Cta =
  | {
      readonly kind: 'link';
      readonly label: string;
      readonly href: string;
      readonly variant: 'primary' | 'secondary' | 'ghost';
    }
  | { readonly kind: 'inert'; readonly id: InertActionId };

/** What the detail page's side panel shows for the viewer. */
export type Panel = {
  readonly headline: string;
  /** Show the places bar with its "N of M places" line. */
  readonly places: boolean;
  readonly body: string | null;
  readonly checks: readonly string[];
  readonly callout: string | null;
  readonly firstRound: string | null;
  readonly ctas: readonly Cta[];
};

const link = (
  label: string,
  href: string,
  variant: 'primary' | 'secondary' | 'ghost' = 'primary',
): Cta => ({ kind: 'link', label, href, variant });

const empty: Panel = {
  headline: '',
  places: false,
  body: null,
  checks: [],
  callout: null,
  firstRound: null,
  ctas: [],
};

type Build = (view: TournamentView) => Panel;

const closes = (view: TournamentView): string | null =>
  view.tournament.registrationClosesAt
    ? `Closes ${formatWhen(view.tournament.registrationClosesAt)}.`
    : null;

const anyRating = (view: TournamentView): string =>
  view.tournament.band.min === null && view.tournament.band.max === null
    ? 'Open to any rating'
    : `Open to ratings ${bandLabel(view.tournament.band)}`;

const when = (iso: string | null, fallback: string): string =>
  iso ? formatWhen(iso) : fallback;

const builders: Readonly<Record<RegistrationState, Build>> = {
  open: (view) => ({
    ...empty,
    headline: 'Registration open',
    places: true,
    body: closes(view),
    checks: [
      'You have a username and a rating',
      anyRating(view),
      'No judging conflict on record',
    ],
    ctas: [
      link('Register', tournamentRoutes.enter(view.tournament.id)),
      link('Volunteer to judge instead', tournamentRoutes.judge, 'ghost'),
    ],
  }),
  'signed-out': (view) => ({
    ...empty,
    headline: 'Registration open',
    places: true,
    body: closes(view),
    ctas: [
      link(
        'Sign in to register',
        signInHref(tournamentRoutes.enter(view.tournament.id)),
      ),
    ],
  }),
  registered: ({ tournament, schedule }) => {
    const post = schedule.find((item) => item.label !== 'Registration closes');
    return {
      ...empty,
      headline: 'You are registered',
      places: true,
      callout: post ? `Bracket posts ${formatWhen(post.at)}` : null,
      firstRound: `${formatWhen(tournament.startsAt)} (check-in ${formatTime(shiftMinutes(tournament.startsAt, -CHECK_IN_MINUTES))})`,
      ctas: [
        { kind: 'inert', id: 'calendar' },
        link('Withdraw', tournamentRoutes.withdraw(tournament.id), 'ghost'),
      ],
    };
  },
  full: ({ tournament }) => ({
    ...empty,
    headline: 'Full, waitlist open',
    places: true,
    body: `${tournament.waitlisted} on the waitlist`,
    ctas: [link('Join the waitlist', tournamentRoutes.enter(tournament.id))],
  }),
  waitlisted: ({ tournament, entry }) => ({
    ...empty,
    headline: `Waitlisted, position ${entry?.kind === 'waitlisted' ? entry.position : tournament.waitlisted}`,
    places: true,
    ctas: [
      link(
        'Leave the waitlist',
        tournamentRoutes.withdraw(tournament.id),
        'secondary',
      ),
    ],
  }),
  closed: ({ tournament }) => ({
    ...empty,
    headline: 'Registration closed',
    places: true,
    body: `Round 1 starts ${formatWhen(tournament.startsAt)}`,
    ctas: [
      link('Follow this tournament', tournamentRoutes.bracket(tournament.id)),
    ],
  }),
  'not-open': ({ tournament }) => ({
    ...empty,
    headline: 'Not open yet',
    body: `Registration opens ${when(tournament.registrationOpensAt, 'soon')}.`,
    ctas: [{ kind: 'inert', id: 'remind' }],
  }),
  'in-progress': ({ tournament }) => ({
    ...empty,
    headline: 'In progress',
    body: `${slotsLabel(tournament)} debaters competing`,
    ctas: [
      link('Follow this tournament', tournamentRoutes.bracket(tournament.id)),
    ],
  }),
  competing: ({ tournament }) => ({
    ...empty,
    headline: 'You are competing',
    ctas: [
      link('Open my event', tournamentRoutes.myEvent(tournament.id)),
      link(
        'Follow the bracket',
        tournamentRoutes.bracket(tournament.id),
        'secondary',
      ),
    ],
  }),
  completed: ({ tournament }) => ({
    ...empty,
    headline: 'Completed',
    body: tournament.outcome
      ? `${tournament.outcome.label}: @${tournament.outcome.handle}.`
      : null,
    ctas: [link('See results', tournamentRoutes.results(tournament.id))],
  }),
};

/** The side panel for the viewer's registration state. */
export const registrationPanel = (view: TournamentView): Panel =>
  builders[view.state](view);
