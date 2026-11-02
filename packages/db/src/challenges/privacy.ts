import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

/** Challenges' subject rights (ADR 0098): every challenge naming the subject. */
export const challengesPrivacyAdopter: PrivacyAdopter = {
  id: 'challenges',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await tx.execute(
      sql`delete from challenges where challenger_actor_id=${actorId} or challenged_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      challenges: exportRows(
        (await tx.execute(
          sql`select * from challenges where challenger_actor_id=${actorId} or challenged_actor_id=${actorId} order by created_at,id`,
        )) as unknown as Record<string, unknown>[],
      ),
    };
  },
};
