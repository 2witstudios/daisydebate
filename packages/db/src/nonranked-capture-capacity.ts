import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { takeLock, transactionLocks } from './locks';
import { query } from './raw-rows';

/** The existing one-Egress nonranked physical fleet, shared by ordinary and tournament capture. */
export const NONRANKED_CAPTURE_FLEET_LIMIT = 1;
export const lockNonrankedCaptureCapacity = async (tx: Tx): Promise<void> => {
  await takeLock(tx, transactionLocks.nonrankedCaptureCapacity());
};
const capacityRow = z.strictObject({
  running: z.int().nonnegative(),
  hosted: z.int().nonnegative(),
  sponsored: z.int().nonnegative(),
  tournament: z.int().nonnegative(),
});

/** A named read-only count crosses tenant scopes without returning another tenant's identity. */
export const readNonrankedCaptureCapacity = async (
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly hostActorId: string | null;
    readonly sponsorUserId: string | null;
    readonly lobbyId: string | null;
  },
) => {
  const [counts] = await query(
    tx,
    capacityRow,
    sql`select * from public.daisy_nonranked_capture_capacity(${input.roundId},${input.hostActorId},${input.sponsorUserId},${input.lobbyId})`,
  );
  if (!counts) throw createAppError('INFRASTRUCTURE');
  return counts;
};
