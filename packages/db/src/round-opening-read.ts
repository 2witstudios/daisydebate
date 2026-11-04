import { eq } from 'drizzle-orm';
import {
  clockStopsOf,
  type LaunchedRound,
  type RoundView,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import type { RoundOpening } from '@daisy/protocol/resolution-draw';
import { transactionNow, type Account, type Tx } from './room-command-facts';
import { humanSeatEligible } from './seat-eligibility';
import { loadRoundDraw } from './room-draw-persistence';
import { rounds } from './schema/rounds';

/** The stored opening with its secret seed: read here, never delivered. */
export type StoredOpening = {
  readonly state: RoundOpening;
  readonly seed: string | null;
};

/** The one reading of a Round's stored opening; null once it has left it. */
export const loadRoundOpening = async (
  tx: Pick<Tx, 'select'>,
  round: {
    readonly id: string;
    readonly status: string;
    readonly createdAt: Date;
    readonly preRoundPrepMs: number | null;
    readonly runtimeState: RuntimeCheckpoint;
  },
): Promise<StoredOpening | null> => {
  if (round.status !== 'opening') return null;
  const draw = await loadRoundDraw(tx, round.id);
  return {
    state: {
      startedAt: round.createdAt.toISOString(),
      draw: draw?.state ?? null,
      prepMs: round.preRoundPrepMs,
      stops: clockStopsOf(round.runtimeState),
    },
    seed: draw?.seed ?? null,
  };
};

/** The engine's reading of an opening for one viewer, at the database clock. */
export type ReadOpening = (
  opening: StoredOpening,
  seats: LaunchedRound['participants'],
  viewer: { readonly actorId: string; readonly eligible: boolean },
  now: string,
) => {
  readonly view: NonNullable<RoundView['opening']>;
  readonly topic: string | null;
};

/** The stored opening of a Round still in it, at the database clock. */
const openingNow = async (tx: Tx, roundId: string) => {
  const [row] = await tx
    .select({
      id: rounds.id,
      status: rounds.status,
      createdAt: rounds.createdAt,
      preRoundPrepMs: rounds.preRoundPrepMs,
      runtimeState: rounds.runtimeState,
    })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  const opening = row && (await loadRoundOpening(tx, row));
  return opening ? { opening, now: await transactionNow(tx) } : null;
};

/** The engine's settled resolution of an opening, for any viewer. */
export type ReadOpeningTopic = (
  opening: StoredOpening,
  now: string,
) => string | null;

/**
 * The one answer to a Room's resolution: what is stored, or, while its Round is
 * opening, what that opening has settled to before a tick stores it
 * (ISSUE-1127). Only a Round still undecided costs a read of its opening.
 */
export const currentRoomTopic = async (
  tx: Tx,
  room: {
    readonly topic: string | null;
    readonly roundRef: { readonly id: string; readonly status: string } | null;
  },
  readTopic: ReadOpeningTopic,
): Promise<string | null> => {
  if (room.topic !== null || room.roundRef?.status !== 'opening')
    return room.topic;
  const settled = await openingNow(tx, room.roundRef.id);
  return settled && readTopic(settled.opening, settled.now);
};

/** A viewer's Round with its opening read; only an opening Round costs a read. */
export const withOpening = async (
  tx: Tx,
  round: LaunchedRound,
  view: RoundView,
  viewer: { readonly actorId: string; readonly account: Account },
  readOpening: ReadOpening,
): Promise<RoundView> => {
  if (view.status !== 'opening') return view;
  const settled = await openingNow(tx, round.id);
  if (!settled) return view;
  const read = readOpening(
    settled.opening,
    round.participants,
    {
      actorId: viewer.actorId,
      eligible: humanSeatEligible([viewer.account], viewer.actorId),
    },
    settled.now,
  );
  return { ...view, opening: read.view, topic: view.topic ?? read.topic };
};
