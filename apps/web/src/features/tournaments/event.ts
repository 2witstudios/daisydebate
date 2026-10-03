import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { formatTime, shiftMinutes } from './dates';
import type { Viewer } from './entry';
import { tournamentRoutes } from './routes';
import { CHECK_IN_MINUTES, FORFEIT_GRACE_MINUTES } from './schedule';
import type { Tournament } from './tournament';
import type { Cta } from './panel';

export const eventMoments = [
  'waiting',
  'released',
  'checkin',
  'live',
  'won',
  'lost',
] as const;
export type EventMoment = (typeof eventMoments)[number];

export type Side = 'Affirmative' | 'Negative';

export type Pairing = {
  readonly stage: string;
  readonly opponent: {
    readonly handle: string;
    readonly seed: number;
    readonly rating: number;
  };
  readonly side: Side;
  readonly judge: string;
  readonly room: string;
  readonly roomSlug: string;
  /** UTC ISO timestamp. */
  readonly startsAt: string;
};

type PlayedRound = {
  readonly stage: string;
  readonly opponent: string;
  readonly side: Side;
  readonly judge: string;
  readonly result: 'Won' | 'Lost';
};

/** The viewer's event in one tournament as the read returns it. */
export type EventData = {
  readonly tournament: Tournament;
  readonly viewer: Viewer;
  readonly seed: number;
  readonly played: readonly PlayedRound[];
  readonly pairing: Pairing;
  readonly final: { readonly stage: string; readonly startsAt: string };
  readonly watching: number;
};

const schema = z.object({ moment: z.enum(eventMoments).catch('released') });

/** The URL names a moment; the real read derives it from server state. */
export const parseEventMoment = (params: SearchParams): EventMoment => {
  const value = params['moment'];
  return schema.parse({
    moment: typeof value === 'string' ? value : value?.[0],
  }).moment;
};

export const eventHref = (id: string, moment: EventMoment): string =>
  moment === 'released'
    ? tournamentRoutes.myEvent(id)
    : `${tournamentRoutes.myEvent(id)}?moment=${moment}`;

type PathMark = 'W' | 'L' | 'Now' | '';
type PathStep = {
  readonly mark: PathMark;
  readonly stage: string;
  readonly detail: string;
};
export type Hero = {
  readonly eyebrow: string;
  readonly note: string;
  readonly live: boolean;
  readonly title: string;
  readonly body: string | null;
  readonly showPairing: boolean;
  readonly status: string | null;
  readonly reason: boolean;
  readonly ctas: readonly Cta[];
  /**
   * Extra controls. One with a `reason` is unavailable right now and says
   * why; one without is a sample action, since its operation has no backend.
   */
  readonly inert: readonly {
    readonly label: string;
    readonly reason?: string;
  }[];
};
export type EventScreen = {
  readonly moment: EventMoment;
  readonly roundLabel: string;
  readonly hero: Hero;
  readonly path: readonly PathStep[];
  readonly rounds: readonly PlayedRound[];
  readonly pairing: Pairing;
};

const link = (
  label: string,
  href: string,
  variant: 'primary' | 'secondary' | 'ghost' = 'primary',
): Cta => ({ kind: 'link', label, href, variant });

const reportConflict = { label: 'Report a conflict' };
const disabledCheckIn = (opens: string) => ({
  label: `Check in (opens ${opens})`,
  reason: `Check-in opens ${CHECK_IN_MINUTES} minutes before the round.`,
});

const empty: Hero = {
  eyebrow: '',
  note: '',
  live: false,
  title: '',
  body: null,
  showPairing: false,
  status: null,
  reason: false,
  ctas: [],
  inert: [],
};

type Context = {
  readonly data: EventData;
  readonly minutes: number;
  readonly opens: string;
  readonly byTime: string;
  readonly room: string;
};

const contextOf = (data: EventData, now: string): Context => {
  const { pairing, tournament } = data;
  return {
    data,
    minutes: Math.max(
      1,
      Math.round((Date.parse(pairing.startsAt) - Date.parse(now)) / 60_000),
    ),
    opens: formatTime(shiftMinutes(pairing.startsAt, -CHECK_IN_MINUTES)),
    byTime: formatTime(shiftMinutes(pairing.startsAt, FORFEIT_GRACE_MINUTES)),
    room: tournamentRoutes.room(tournament.id, pairing.roomSlug),
  };
};

const heroes: Readonly<Record<EventMoment, (context: Context) => Hero>> = {
  waiting: ({ data }) => ({
    ...empty,
    eyebrow: 'Waiting',
    note: 'Semifinal pairings release when the last quarterfinal ends',
    title: 'You won the quarterfinal. Semifinal pairings come next.',
    body: 'One quarterfinal is still in progress. As soon as it ends, the system pairs the semifinals, assigns judges and rooms, and tells you. You do not need to do anything.',
    ctas: [
      link(
        'Watch the last quarterfinal',
        tournamentRoutes.bracket(data.tournament.id),
        'secondary',
      ),
    ],
  }),
  released: ({ minutes, opens }) => ({
    ...empty,
    eyebrow: 'Pairing out',
    note: `Starts in ${minutes} minutes`,
    title: 'Your semifinal is set',
    showPairing: true,
    inert: [disabledCheckIn(opens), reportConflict],
  }),
  checkin: ({ data, byTime, room }) => ({
    ...empty,
    eyebrow: 'Check-in open',
    note: `Check in by ${byTime} or the round can be forfeited`,
    title: 'Check in to enter your room',
    showPairing: true,
    status: `@${data.pairing.opponent.handle} has checked in. @${data.pairing.judge} has joined the room.`,
    ctas: [link('Check in and open room', room)],
    inert: [reportConflict],
  }),
  live: ({ data, room }) => ({
    ...empty,
    eyebrow: 'In progress',
    note: `${data.watching} watching`,
    live: true,
    title: 'Your debate is in progress',
    body: `You are the ${data.pairing.side} in the room. If you lose your connection you can rejoin. The clock keeps running.`,
    ctas: [link('Return to room', room)],
  }),
  won: ({ data }) => ({
    ...empty,
    eyebrow: 'Advanced',
    title: 'You won. You are in the final.',
    body: `@${data.pairing.judge} voted ${data.pairing.side}. The organizer has not corrected this result. Your final is today at ${formatTime(data.final.startsAt)} UTC and the pairing releases once the other semifinal ends.`,
    reason: true,
    ctas: [
      link('See the bracket', tournamentRoutes.bracket(data.tournament.id)),
      link('Watch the recording', '/recordings', 'secondary'),
    ],
  }),
  lost: ({ data }) => ({
    ...empty,
    eyebrow: 'Eliminated',
    title: 'You lost the semifinal. You finish equal third.',
    body: 'Your run ends here. You earn the Semifinalist honour, which appears on your profile when the organizer publishes results. Thank you for competing.',
    ctas: [
      link('Watch the final', tournamentRoutes.bracket(data.tournament.id)),
      link('Watch your recording', '/recordings', 'secondary'),
      link('Find the next event', tournamentRoutes.index, 'ghost'),
    ],
  }),
};

const roundLabels: Readonly<Record<EventMoment, string>> = {
  waiting: 'Quarterfinals complete',
  released: 'Semifinal, starts {time}',
  checkin: 'Semifinal, check-in open',
  live: 'Semifinal, in progress',
  won: 'Semifinal complete',
  lost: 'Semifinal complete',
};

const pathOf = (data: EventData, moment: EventMoment): PathStep[] => {
  const { played, pairing, final } = data;
  const finalTime = `Today, ${formatTime(final.startsAt)}`;
  const quarter: PathStep = {
    mark: 'W',
    stage: 'Quarterfinal',
    detail: `Won vs @${played[0]?.opponent ?? ''}`,
  };
  const vs = `vs @${pairing.opponent.handle}`;
  switch (moment) {
    case 'waiting':
      return [
        quarter,
        { mark: '', stage: 'Semifinal', detail: 'Pairing not out yet' },
        { mark: '', stage: 'Final', detail: finalTime },
      ];
    case 'won':
      return [
        quarter,
        { mark: 'W', stage: 'Semifinal', detail: `Won ${vs}` },
        {
          mark: 'Now',
          stage: 'Final',
          detail: `${finalTime} vs the other semifinal's winner`,
        },
      ];
    case 'lost':
      return [
        quarter,
        {
          mark: 'L',
          stage: 'Semifinal',
          detail: `Lost to @${pairing.opponent.handle}`,
        },
        { mark: '', stage: 'Final', detail: 'Not reached' },
      ];
    default:
      return [
        quarter,
        { mark: 'Now', stage: 'Semifinal', detail: vs },
        { mark: '', stage: 'Final', detail: finalTime },
      ];
  }
};

/**
 * The participant event view's one driver: a moment in the tournament
 * becomes everything the screen shows. The real read derives the moment
 * from the tournament's state and the clock; nothing else changes.
 */
export function eventFlow(
  data: EventData,
  moment: EventMoment,
  now: string,
): EventScreen {
  const { pairing } = data;
  const finished = moment === 'won' || moment === 'lost';
  return {
    moment,
    roundLabel: roundLabels[moment].replace(
      '{time}',
      formatTime(pairing.startsAt),
    ),
    hero: heroes[moment](contextOf(data, now)),
    path: pathOf(data, moment),
    rounds: finished
      ? [
          ...data.played,
          {
            stage: pairing.stage,
            opponent: pairing.opponent.handle,
            side: pairing.side,
            judge: pairing.judge,
            result: moment === 'won' ? 'Won' : 'Lost',
          },
        ]
      : data.played,
    pairing,
  };
}
