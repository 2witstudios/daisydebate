import { guardianLinkStatuses } from '@daisy/protocol/guardians';
import { listedWord } from '../lifecycle-sql';
import { sql } from 'drizzle-orm';
import {
  lockAuthorizationActors,
  readAuthorizationActors,
} from '../authorization';
import type { Tx } from '../tx';
import { query } from '../raw-rows';
import { z } from 'zod';
import { scopeTransaction } from '../tenant-scope';

export type GuardianChildAuthority = {
  readonly guardian: { readonly userId: string; readonly actorId: string };
  readonly linkId: string;
};

/** Resolve the child from the guardian's link and recheck it under the account fence. */
export async function findActiveGuardianChild(
  tx: Tx,
  { guardian, linkId }: GuardianChildAuthority,
  mode: 'read' | 'write',
) {
  await scopeTransaction(tx, { subjectUserId: guardian.userId });
  const readLink = async () => {
    const [link] = await query(
      tx,
      z.object({
        userId: z.string(),
        actorId: z.string(),
        username: z.string().nullable(),
      }),
      sql`
      select l.minor_user_id as "userId", a.id as "actorId", u.username
      from guardian_links l
      join actors a on a.user_id = l.minor_user_id
      join users u on u.id = l.minor_user_id
      where l.id = ${linkId} and l.guardian_user_id = ${guardian.userId}
        and l.status = ${listedWord(guardianLinkStatuses, 'active')}
    `,
    );
    return link;
  };
  try {
    const candidate = await readLink();
    if (!candidate || guardian.actorId === candidate.actorId) return null;
    const accounts =
      mode === 'write' ? lockAuthorizationActors : readAuthorizationActors;
    const [parent, minor] = await accounts(
      tx,
      [guardian.actorId, candidate.actorId],
      { maxActors: 2 },
    );
    if (
      !parent?.member ||
      parent.erased ||
      parent.restricted ||
      parent.userId !== guardian.userId ||
      parent.ageBand !== 'adult'
    )
      return null;
    const child = await readLink();
    if (
      !minor?.member ||
      minor.erased ||
      minor.userId !== child?.userId ||
      minor.actorId !== child.actorId ||
      (minor.ageBand !== '13-15' && minor.ageBand !== '16-17')
    )
      return null;
    return child;
  } finally {
    await scopeTransaction(tx, {});
  }
}
