import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol/primitives';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows, run, query } from '../raw-rows';
import { z } from 'zod';

/** Presence's subject rights (ADR 0072): the member's own visibility choice. */
export const presencePrivacyAdopter: PrivacyAdopter = {
  id: 'presence',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await run(tx, sql`delete from presence_settings where actor_id=${actorId}`);
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      presence_settings: exportRows(
        await query(
          tx,
          z.object({
            actor_id: z.string(),
            updated_at: z.date(),
            chosen_status: z.string(),
          }),
          sql`select * from presence_settings where actor_id=${actorId}`,
        ),
      ),
    };
  },
};
