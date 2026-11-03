import { asc, eq, inArray } from 'drizzle-orm';
import type { LaunchedRound, RoundView } from '@daisy/protocol';
import type {
  RoundOpening,
  RoundOpeningClock,
} from '@daisy/protocol/resolution-draw';
import {
  roundResolutionDraws,
  roundResolutionStrikes,
} from './schema/resolution-draws';
import { transactionNow, type Tx } from './room-command-facts';
import { loadRoundDraw } from './round-draw-persistence';
import { rounds } from './schema/rounds';

/** The stored opening with its secret seed: read here, never delivered. */
export type StoredOpening = {
  readonly state: RoundOpening;
  readonly seed: string | null;
};

/** The one reading of an opening Round's stored opening. */
export const loadRoundOpening = async (
  tx: Pick<Tx, 'select'>,
  round: {
    readonly id: string;
    readonly createdAt: Date;
    readonly preRoundPrepMs: number | null;
  },
): Promise<StoredOpening> => {
  const draw = await loadRoundDraw(tx, round.id);
  return {
    state: {
      startRoundAt: round.createdAt.toISOString(),
      draw: draw?.state ?? null,
      prepMs: round.preRoundPrepMs,
    },
    seed: draw?.seed ?? null,
  };
};

/**
 * The clocks of opening Rounds, by id: one read for a whole discovery page, and
 * none of a draw's texts, positions or seed.
 */
export const readOpeningClocks = async (
  tx: Pick<Tx, 'select'>,
  opening: readonly {
    readonly id: string;
    readonly createdAt: Date;
    readonly preRoundPrepMs: number | null;
  }[],
): Promise<ReadonlyMap<string, RoundOpeningClock>> => {
  if (opening.length === 0) return new Map();
  const draws = await tx
    .select({
      id: roundResolutionDraws.id,
      roundId: roundResolutionDraws.roundId,
      manifest: roundResolutionDraws.manifest,
      startedAt: roundResolutionDraws.startedAt,
    })
    .from(roundResolutionDraws)
    .where(
      inArray(
        roundResolutionDraws.roundId,
        opening.map((round) => round.id),
      ),
    );
  const strikes = draws.length
    ? await tx
        .select({
          drawId: roundResolutionStrikes.drawId,
          at: roundResolutionStrikes.struckAt,
        })
        .from(roundResolutionStrikes)
        .where(
          inArray(
            roundResolutionStrikes.drawId,
            draws.map((draw) => draw.id),
          ),
        )
        .orderBy(asc(roundResolutionStrikes.ordinal))
    : [];
  return new Map(
    opening.map((round) => {
      const draw = draws.find((row) => row.roundId === round.id);
      return [
        round.id,
        {
          startRoundAt: round.createdAt.toISOString(),
          prepMs: round.preRoundPrepMs,
          draw: draw
            ? {
                manifest: draw.manifest,
                startedAt: draw.startedAt.toISOString(),
                strikes: strikes
                  .filter((strike) => strike.drawId === draw.id)
                  .map((strike) => ({ at: strike.at.toISOString() })),
              }
            : null,
        },
      ];
    }),
  );
};

/** The engine's reading of an opening for one viewer, at the database clock. */
export type ReadOpening = (
  opening: StoredOpening,
  seats: LaunchedRound['participants'],
  viewerActorId: string,
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
    })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  return row?.status === 'opening'
    ? {
        opening: await loadRoundOpening(tx, row),
        now: await transactionNow(tx),
      }
    : null;
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
  viewerActorId: string,
  readOpening: ReadOpening,
): Promise<RoundView> => {
  if (view.status !== 'opening') return view;
  const settled = await openingNow(tx, round.id);
  if (!settled) return view;
  const read = readOpening(
    settled.opening,
    round.participants,
    viewerActorId,
    settled.now,
  );
  return { ...view, opening: read.view, topic: view.topic ?? read.topic };
};
