import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/**
 * Reports' and moderation's subject rights (ADR 0098). Erasure removes every
 * report naming the subject and their moderation record. Export gives a
 * subject reports they filed, without another member's sanction, and those
 * about them without who filed them.
 */
export const reportsPrivacyAdopter: PrivacyAdopter = {
  id: 'reports',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    const userId = idSchema.parse(subject.userId);
    await tx.execute(
      sql`delete from reports where reporter_actor_id=${actorId} or subject_actor_id=${actorId}`,
    );
    await tx.execute(
      sql`delete from moderation_actions where user_id=${userId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    const userId = idSchema.parse(subject.userId);
    return {
      reports_filed: exportRows(
        rowsOf(
          await tx.execute(
            sql`select id, subject_actor_id, reason, surface, created_at, closed_at from reports where reporter_actor_id=${actorId} order by created_at,id`,
          ),
        ),
      ),
      reports_about: exportRows(
        rowsOf(
          await tx.execute(
            sql`select id, reason, surface, created_at, closed_at, outcome from reports where subject_actor_id=${actorId} order by created_at,id`,
          ),
        ),
      ),
      moderation_actions: exportRows(
        rowsOf(
          await tx.execute(
            sql`select id, kind, starts_at, ends_at, lifted_at, acknowledged_at from moderation_actions where user_id=${userId} order by starts_at,id`,
          ),
        ),
      ),
    };
  },
};
