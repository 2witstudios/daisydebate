import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { formatTime, shiftMinutes } from './dates';
import type { EventData, Side } from './event';
import { tournamentRoutes } from './routes';
import { FORFEIT_GRACE_MINUTES } from './schedule';

export const roomStates = ['not-ready', 'ready', 'starting', 'absent'] as const;
export type RoomState = (typeof roomStates)[number];

const schema = z.object({ state: z.enum(roomStates).catch('not-ready') });

/** The URL names the room's moment; the real room reads live presence. */
export const parseRoomState = (params: SearchParams): RoomState => {
  const value = params['state'];
  return schema.parse({ state: typeof value === 'string' ? value : value?.[0] })
    .state;
};

export const roomHref = (id: string, slug: string, state: RoomState): string =>
  state === 'not-ready'
    ? tournamentRoutes.room(id, slug)
    : `${tournamentRoutes.room(id, slug)}?state=${state}`;

export type Seat = {
  readonly side: Side;
  readonly handle: string;
  readonly detail: string;
  readonly you: boolean;
  readonly status: 'Ready' | 'Not ready' | 'Not checked in';
};

export type RoomAction =
  | { readonly kind: 'ready'; readonly href: string }
  | { readonly kind: 'waiting'; readonly opponent: string }
  | { readonly kind: 'starting'; readonly seconds: number }
  | {
      readonly kind: 'absent';
      readonly opponent: string;
      /** UTC clock time the forfeit can be claimed. */
      readonly claimAt: string;
    };

export type RoomScreen = {
  readonly state: RoomState;
  readonly title: string;
  readonly seats: readonly Seat[];
  readonly judge: string;
  readonly action: RoomAction;
  readonly watching: number;
};

/** Seconds the countdown shows while a debate is starting (a sample). */
const START_SECONDS = 5;

const order = (side: Side): number => (side === 'Affirmative' ? 0 : 1);

const other = (side: Side): Side =>
  side === 'Affirmative' ? 'Negative' : 'Affirmative';

function actionFor(data: EventData, state: RoomState): RoomAction {
  const { pairing, tournament } = data;
  switch (state) {
    case 'not-ready':
      return {
        kind: 'ready',
        href: roomHref(tournament.id, pairing.roomSlug, 'ready'),
      };
    case 'ready':
      return { kind: 'waiting', opponent: pairing.opponent.handle };
    case 'starting':
      return { kind: 'starting', seconds: START_SECONDS };
    case 'absent':
      return {
        kind: 'absent',
        opponent: pairing.opponent.handle,
        claimAt: formatTime(
          shiftMinutes(pairing.startsAt, FORFEIT_GRACE_MINUTES),
        ),
      };
  }
}

/**
 * The pairing room's one driver. Seats and judge are fixed by the pairing;
 * only readiness moves. The real room replaces `state` with live presence.
 */
export function roomFlow(data: EventData, state: RoomState): RoomScreen {
  const { pairing, viewer, seed } = data;
  const youReady = state !== 'not-ready' && state !== 'absent';
  const opponentStatus: Seat['status'] =
    state === 'absent' ? 'Not checked in' : 'Ready';
  const seats: Seat[] = [
    {
      side: pairing.side,
      handle: viewer.handle,
      detail: `Seed ${seed}, rating ${viewer.rating}`,
      you: true,
      status: youReady ? 'Ready' : 'Not ready',
    },
    {
      side: other(pairing.side),
      handle: pairing.opponent.handle,
      detail: `Seed ${pairing.opponent.seed}, rating ${pairing.opponent.rating}`,
      you: false,
      status: opponentStatus,
    },
  ];
  return {
    state,
    title: `${pairing.stage} ${pairing.roomSlug.split('-').at(-1)} room`,
    seats: seats.sort((a, b) => order(a.side) - order(b.side)),
    judge: pairing.judge,
    action: actionFor(data, state),
    watching: data.watching,
  };
}
