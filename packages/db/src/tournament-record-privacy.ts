import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { scopeTransaction } from './tenant-scope';

type Rows = Record<string, unknown>[];

/**
 * The tournament record (docs/operations/compliance.md): the entries a
 * member was in and the tournaments they judged. It is competitive record,
 * keyed by actor, so erasure keeps it whole and this step deletes nothing
 * (ADR 0087, DEC-261). Export returns the member's own rows, read under the
 * subject scope across every tournament.
 */
export const tournamentRecordPrivacyAdopter: PrivacyAdopter = {
  id: 'tournament-record',
  phase: 'after-close',
  erase: async () => undefined,
  export: async (tx, subject) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const result = {
      entry_members: exportRows(
        (await tx.execute(
          sql`select entry_id, event_id, lobby_id, created_at from entry_members
            where actor_id = ${subject.actorId} order by lobby_id, event_id, entry_id`,
        )) as unknown as Rows,
      ),
      tournament_judges: exportRows(
        (await tx.execute(
          sql`select id, lobby_id, status, chair_qualified, created_at from tournament_judges
            where actor_id = ${subject.actorId} order by lobby_id, id`,
        )) as unknown as Rows,
      ),
    };
    await scopeTransaction(tx, {});
    return result;
  },
};
