import { eq } from 'drizzle-orm';
import type { LaunchedRound, RoundView } from '@daisy/protocol';
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
  viewer: { readonly actorId: string; readonly eligible: boolean },
  now: string,
) => {
  readonly view: NonNullable<RoundView['opening']>;
  readonly topic: string | null;
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
  const [row] = await tx
    .select({
      id: rounds.id,
      status: rounds.status,
      createdAt: rounds.createdAt,
      preRoundPrepMs: rounds.preRoundPrepMs,
    })
    .from(rounds)
    .where(eq(rounds.id, round.id));
  const opening = row && (await loadRoundOpening(tx, row));
  if (!opening) return view;
  const read = readOpening(
    opening,
    round.participants,
    {
      actorId: viewer.actorId,
      eligible: humanSeatEligible([viewer.account], viewer.actorId),
    },
    await transactionNow(tx),
  );
  return { ...view, opening: read.view, topic: read.topic ?? view.topic };
};
