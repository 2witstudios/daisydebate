import type {
  LaunchedRound,
  RoundWaitingFacts,
  RoundWaitingOn,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readAttendanceLedger } from './attendance-settlement';
import { readJudgingPanelFacts } from './judging-panel-read';

/** Spares the hottest read this query for the whole of a running debate. */
const speechesEnded = (round: Pick<LaunchedRound, 'rules' | 'segments'>) =>
  round.segments.length === round.rules.segments.length &&
  round.segments.at(-1)?.endedAt !== null;

/** Facts only: the injected engine decision says what they mean. */
async function readWaitingFacts(
  tx: Pick<BunSQLDatabase, 'select' | 'execute'>,
  round: Pick<LaunchedRound, 'id' | 'transcriptCompleteness'>,
): Promise<RoundWaitingFacts> {
  const [facts] = (await tx.execute(sql`select
    clock_timestamp()::text as now,
    r.final_segment_ended_at is not null as ended
    from rounds r where r.id=${round.id}`)) as unknown as {
    now: string;
    ended: boolean;
  }[];
  if (!facts!.ended) return { speeches: 'running' };
  return {
    speeches: 'ended',
    nowMs: Date.parse(facts!.now),
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
  tx: Pick<BunSQLDatabase, 'select' | 'execute'>,
  round: Pick<
    LaunchedRound,
    'id' | 'status' | 'rules' | 'segments' | 'transcriptCompleteness'
  >,
  decide: (facts: RoundWaitingFacts) => RoundWaitingOn | null,
): Promise<RoundWaitingOn | null> =>
  round.status === 'active' && speechesEnded(round)
    ? decide(await readWaitingFacts(tx, round))
    : null;
