import { readDatabaseTime } from './database-clock';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import type { Tx } from './tx';
/** Trusted persistence resource, never a request, tenant setting or environment clock. */
export type RoundTimeSource = (tx: Tx) => Promise<string>;
const utc = z.iso.datetime();
/** One separately sampled instant after every required transaction lock. */
export async function sampleRoundExecutionTime(
  tx: Tx,
  source?: RoundTimeSource,
): Promise<string> {
  if (source) {
    const now = await source(tx);
    if (!utc.safeParse(now).success)
      throw createAppError('INVARIANT', 'Round time must be UTC');
    return now;
  }
  return (await readDatabaseTime(tx)).toISOString();
}
