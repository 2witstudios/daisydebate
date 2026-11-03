import { eq } from 'drizzle-orm';
import type { LaunchedRound, RoundView } from '@daisy/protocol';
import type { RoundOpening } from '@daisy/protocol/resolution-draw';
import { transactionNow, type Tx } from './room-command-facts';
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
  },
): Promise<StoredOpening | null> => {
  if (round.status !== 'opening') return null;
  const draw = await loadRoundDraw(tx, round.id);
  return {
    state: {
      startedAt: round.createdAt.toISOString(),
      draw: draw?.state ?? null,
      prepMs: round.preRoundPrepMs,
    },
    seed: draw?.seed ?? null,
  };
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
  const opening = row && (await loadRoundOpening(tx, row));
  return opening ? { opening, now: await transactionNow(tx) } : null;
};

/** The engine's settled resolution of an opening, for any viewer. */
export type ReadOpeningTopic = (
  opening: StoredOpening,
  now: string,
) => string | null;

/**
 * The resolution a Round in its opening has settled to, before a tick stores
 * it (ISSUE-1127). The Room read and the Lobby read it here, so they answer as
 * the Round read does.
 */
export const settledRoundTopic = async (
  tx: Tx,
  roundId: string,
  readTopic: ReadOpeningTopic,
): Promise<string | null> => {
  const settled = await openingNow(tx, roundId);
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
  return { ...view, opening: read.view, topic: read.topic ?? view.topic };
};
