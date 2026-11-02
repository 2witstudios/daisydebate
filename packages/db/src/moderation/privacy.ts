import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

/**
 * Moderation's subject rights (ADR 0098). Closing an account never wipes its
 * sanctions: they stay through their proposed retention (DEC-298). Export gives
 * the subject their own.
 */
export const moderationPrivacyAdopter: PrivacyAdopter = {
  id: 'moderation',
  phase: 'after-close',
  async erase() {},
  async export(tx, subject): Promise<PrivacyExport> {
    const userId = idSchema.parse(subject.userId);
    return {
      moderation_actions: exportRows(
        (await tx.execute(
          sql`select id, kind, starts_at, ends_at, lifted_at, acknowledged_at from moderation_actions where user_id=${userId} order by starts_at,id`,
        )) as unknown as Record<string, unknown>[],
      ),
    };
  },
};
