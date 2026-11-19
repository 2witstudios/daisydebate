import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';

/** The existing one-Egress nonranked physical fleet, shared by ordinary and tournament capture. */
export const NONRANKED_CAPTURE_FLEET_LIMIT = 1;
export const lockNonrankedCaptureCapacity = async (tx: Tx): Promise<void> => {
  await tx.execute(sql`select pg_advisory_xact_lock(59081)`);
};
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
  const [counts] = await tx.execute(
    sql`select * from public.daisy_nonranked_capture_capacity(${input.roundId},${input.hostActorId},${input.sponsorUserId},${input.lobbyId})`,
  );
  const parsed = z
    .strictObject({
      running: z.number().int().nonnegative(),
      hosted: z.number().int().nonnegative(),
      sponsored: z.number().int().nonnegative(),
      tournament: z.number().int().nonnegative(),
    })
    .safeParse(counts);
  if (!parsed.success) throw createAppError('INFRASTRUCTURE');
  return parsed.data;
};
