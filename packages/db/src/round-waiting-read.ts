import { createAppError } from '@daisy/errors';
import type {
  LaunchedRound,
  RoundWaitingFacts,
  RoundWaitingOn,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { readAttendanceLedger } from './attendance-settlement';
import { readJudgingPanelFacts } from './judging-panel-read';
import type { Tx } from './tx';
import { query as queryRows } from './raw-rows';
import { z } from 'zod';

/** Spares the hottest read this query for the whole of a running debate. */
const speechesEnded = (round: Pick<LaunchedRound, 'rules' | 'segments'>) =>
  round.segments.length === round.rules.segments.length &&
  round.segments.at(-1)?.endedAt !== null;

/** Facts only: the injected engine decision says what they mean. */
async function readWaitingFacts(
  tx: Tx,
  round: Pick<LaunchedRound, 'id' | 'transcriptCompleteness'>,
): Promise<RoundWaitingFacts> {
  const [facts] = await queryRows(
    tx,
    z.object({ now: z.date(), ended: z.boolean() }),
    sql`select
    clock_timestamp() as now,
    r.final_segment_ended_at is not null as ended
    from rounds r where r.id=${round.id}`,
  );
  if (!facts)
    throw createAppError('INVARIANT', 'Round waiting facts are missing');
  if (!facts.ended) return { speeches: 'running' };
  return {
    speeches: 'ended',
    nowMs: facts.now.getTime(),
    attendance: await readAttendanceLedger(tx, round.id),
    frozen: round.transcriptCompleteness
      ? await readJudgingPanelFacts(tx, {
          roundId: round.id,
          completeness: round.transcriptCompleteness,
        })
      : null,
  };
}

/** What a Round is waiting on, by the engine's injected decision; null unless it is active and played. */
export const readWaitingOn = async (
  tx: Tx,
  round: Pick<
    LaunchedRound,
    'id' | 'status' | 'rules' | 'segments' | 'transcriptCompleteness'
  >,
  decide: (facts: RoundWaitingFacts) => RoundWaitingOn | null,
): Promise<RoundWaitingOn | null> =>
  round.status === 'active' && speechesEnded(round)
    ? decide(await readWaitingFacts(tx, round))
    : null;
