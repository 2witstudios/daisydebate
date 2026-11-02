import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';

/** The rating choice's subject rights (ADR 0103): the member's own row. */
export const ratingVisibilityPrivacyAdopter: PrivacyAdopter = {
  id: 'rating-visibility',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await tx.execute(
      sql`delete from rating_visibility where actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      rating_visibility: exportRows(
        (await tx.execute(
          sql`select * from rating_visibility where actor_id=${actorId}`,
        )) as unknown as Record<string, unknown>[],
      ),
    };
  },
};
