import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import {
  exportRows,
  ownedTableExpectedColumns,
  ownedTablePrivacyFields,
} from '../privacy/owned-tables';

const presenceColumns = {
  presence_settings: {
    identifier: [],
    personal: ['actor_id', 'hidden', 'updated_at'],
    none: [],
  },
} as const;

export const presencePrivacyExpectedColumns =
  ownedTableExpectedColumns(presenceColumns);

export const presencePrivacyFields = ownedTablePrivacyFields({
  owner: 'PRESENCE',
  columns: presenceColumns,
  purpose: () => 'Online status visibility choice',
});

/** Presence's subject rights (ADR 0072): the member's own visibility choice. */
export const presencePrivacyAdopter: PrivacyAdopter = {
  id: 'presence',
  phase: 'after-scrub',
  fields: presencePrivacyFields,
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
