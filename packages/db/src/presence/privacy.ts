import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

/** Presence's subject rights (ADR 0072): the member's own visibility choice. */
export const presencePrivacyAdopter: PrivacyAdopter = {
  id: 'presence',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await tx.execute(
      sql`delete from presence_settings where actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      presence_settings: exportRows(
        (await tx.execute(
          sql`select * from presence_settings where actor_id=${actorId}`,
        )) as unknown as Record<string, unknown>[],
      ),
    };
  },
};
