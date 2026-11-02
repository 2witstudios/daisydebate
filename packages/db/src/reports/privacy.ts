import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/**
 * Reports' subject rights (ADR 0098). Closing an account never wipes its
 * record: reports about the subject stay through their proposed retention
 * (DEC-298), and a report they filed stays with its reporter removed, so one
 * member's erasure cannot empty another's report from the queue. Export gives a
 * subject reports they filed, without another member's sanction, and those
 * about them without who filed them.
 */
export const reportsPrivacyAdopter: PrivacyAdopter = {
  id: 'reports',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await tx.execute(
      sql`update reports set reporter_actor_id = null where reporter_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
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
    };
  },
};
