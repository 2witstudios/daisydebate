import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { scopeTransaction } from './tenant-scope';

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
        await tx.execute(
          sql`select entry_id, event_id, lobby_id, created_at from entry_members
            where actor_id = ${subject.actorId} order by lobby_id, event_id, entry_id`,
        ),
      ),
      tournament_sponsorship_versions: exportRows(
        await tx.execute(sql`select id,lobby_id,version,kind,previous_version_id,
          sponsor_user_id = ${subject.userId} as funding_account,
          acted_by_user_id = ${subject.userId} as acted_by_subject,
          case when sponsor_user_id = ${subject.userId} then hosting_version_id end as hosting_version_id,
          reason,created_at from tournament_sponsorship_versions
          where sponsor_user_id = ${subject.userId} or acted_by_user_id = ${subject.userId}
          order by lobby_id,version`),
      ),
      tournament_capture_admissions: exportRows(
        await tx.execute(sql`select id,round_id,room_id,lobby_id,fixture_id,command_id,
          sponsor_user_id = ${subject.userId} as funding_account,
          official_user_id = ${subject.userId} as acting_official,
          case when sponsor_user_id = ${subject.userId} then hosting_version_id end as hosting_version_id,
          case when sponsor_user_id = ${subject.userId} then sponsorship_version_id end as sponsorship_version_id,
          case when official_user_id = ${subject.userId} then admission->'official'->'authority' end as official_authority,
          deadline_at,settled_at,created_at from tournament_capture_admissions
          where sponsor_user_id = ${subject.userId} or official_user_id = ${subject.userId}
          order by lobby_id,created_at,id`),
      ),
      tournament_judges: exportRows(
        await tx.execute(
          sql`select id, lobby_id, status, chair_qualified, created_at from tournament_judges
            where actor_id = ${subject.actorId} order by lobby_id, id`,
        ),
      ),
    };
    await scopeTransaction(tx, {});
    return result;
  },
};
