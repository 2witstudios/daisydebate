import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { friendRequestState } from '@daisy/protocol/protection-level';
import type { lockAuthorizationActors } from '../authorization';
import { readProtectionLimits } from '../guardians/protection-level';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

type Accounts = Readonly<Awaited<ReturnType<typeof lockAuthorizationActors>>>;
type ApprovalPair = {
  readonly lowActorId: string;
  readonly highActorId: string;
};

export async function guardianHoldsForRequest(
  tx: Pick<Tx, 'execute'>,
  pair: ApprovalPair,
  accounts: Accounts,
  requesterActorId: string,
) {
  const minors = accounts.filter(
    (account) => account?.ageBand === '13-15' || account?.ageBand === '16-17',
  );
  if (!minors.length) return [];
  const approvals = await query(
    tx,
    z.object({ child_actor_id: z.string() }),
    sql`select child_actor_id
      from public.daisy_friend_guardian_clearances(${pair.lowActorId}, ${pair.highActorId})`,
  );
  const facts = await Promise.all(
    minors.flatMap((account) => {
      if (!account?.actorId) return [];
      const actorId = account.actorId;
      return readProtectionLimits(tx, account.userId).then((limits) => ({
        actorId,
        limits,
        direction:
          actorId === requesterActorId
            ? ('outgoing' as const)
            : ('incoming' as const),
        otherAge:
          accounts.find((other) => other?.actorId !== actorId)?.ageBand ?? null,
        cleared: approvals.some(
          (approval) => approval.child_actor_id === actorId,
        ),
      }));
    }),
  );
  return friendRequestState(facts).holds;
}
