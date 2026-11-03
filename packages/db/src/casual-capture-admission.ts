import { createRefusal } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';

/** One host's casual Rounds broadcast or recorded at once. */
export const CASUAL_CAPTURES_PER_HOST = 2;
/**
 * Casual Rounds broadcast or recorded at once, fleet-wide. Each takes one Egress, so
 * this stays below the Egress machines and what is left over is ranked's, which is never
 * refused. Raise it with them (deploy-staging, Adding capacity).
 */
export const CASUAL_CAPTURES_AT_ONCE = 8;

const CASUAL_CAPTURE_LOCK = 59_081;

/**
 * Launch of a casual Round with capture admits it against both caps, or refuses by name
 * and starts nothing. Serialized fleet-wide, so concurrent Launches cannot both read
 * room for one. A running Round is never affected.
 */
export const admitCasualCapture = async (
  tx: Pick<BoundedTransactionContext, 'execute'>,
  input: { readonly hostActorId: string; readonly roundId: string },
): Promise<void> => {
  await tx.execute(sql`select pg_advisory_xact_lock(${CASUAL_CAPTURE_LOCK})`);
  const [counts] = (await tx.execute(sql`select
      count(*)::int as running,
      (count(*) filter (where r.created_by_actor_id = ${input.hostActorId}))::int as hosted
    from rounds r
    where r.competition_type <> 'ranked' and r.capture is not null
      and r.status in ('opening', 'active') and r.id <> ${input.roundId}`)) as unknown as {
    readonly running: number;
    readonly hosted: number;
  }[];
  if ((counts?.hosted ?? 0) >= CASUAL_CAPTURES_PER_HOST)
    throw createRefusal('CONFLICT', 'capture-host-limit');
  if ((counts?.running ?? 0) >= CASUAL_CAPTURES_AT_ONCE)
    throw createRefusal('CONFLICT', 'capture-capacity');
};
