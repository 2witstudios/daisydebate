import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { scopeTransaction } from './tenant-scope';

type Rows = Record<string, unknown>[];

/**
 * The guardian relationship (docs/operations/compliance.md). The tables
 * are closed: the runtime role cannot write a guardian link or a
 * restriction until counsel answers and a later migration opens them, so
 * there is no row to erase and erasure does nothing. What erasing a
 * guardian's account does to the link and to the minor's account is decided
 * with that migration. Export returns the links a person is either side of,
 * with their restrictions, read under the subject scope.
 */
export const guardianLinksPrivacyAdopter: PrivacyAdopter = {
  id: 'guardian-links',
  phase: 'after-close',
  erase: async () => undefined,
  export: async (tx, subject) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const own = sql`guardian_user_id = ${subject.userId} or minor_user_id = ${subject.userId}`;
    const result = {
      guardian_links: exportRows(
        (await tx.execute(
          sql`select id, guardian_user_id, minor_user_id, kind, via_organization_id, status, ended_at
            from guardian_links where ${own} order by id`,
        )) as unknown as Rows,
      ),
      restrictions: exportRows(
        (await tx.execute(
          sql`select guardian_link_id, limits_lobbies, video_audience_cap
            from restrictions where ${own} order by guardian_link_id`,
        )) as unknown as Rows,
      ),
      restriction_lobbies: exportRows(
        (await tx.execute(
          sql`select guardian_link_id, lobby_id
            from restriction_lobbies where ${own} order by guardian_link_id, lobby_id`,
        )) as unknown as Rows,
      ),
    };
    await scopeTransaction(tx, {});
    return result;
  },
};
