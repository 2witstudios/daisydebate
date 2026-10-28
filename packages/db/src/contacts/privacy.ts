import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/**
 * Contacts' subject rights, run after every capability built on the pair
 * has removed its own rows: the subject's pairs, receipts, requests and
 * declines go; export returns only the subject's own side of each.
 */
export const contactsPrivacyAdopter: PrivacyAdopter = {
  id: 'contacts',
  phase: 'after-scrub',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    for (const statement of [
      sql`delete from social_request_declines where low_actor_id=${actorId} or high_actor_id=${actorId}`,
      sql`delete from social_requests where actor_id=${actorId} or counterpart_actor_id=${actorId}`,
      sql`delete from contact_commands where actor_id=${actorId} or counterpart_actor_id=${actorId}`,
      sql`delete from contact_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}`,
    ])
      await tx.execute(statement);
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    // The subject's own block direction only: the other member's is theirs.
    const pairs = rowsOf(
      await tx.execute(
        sql`select * from contact_pairs where low_actor_id=${actorId} or high_actor_id=${actorId} order by low_actor_id,high_actor_id`,
      ),
    ).map((row) => ({
      low_actor_id: row.low_actor_id,
      high_actor_id: row.high_actor_id,
      revision: row.revision,
      ...(row.low_actor_id === actorId
        ? { low_blocks_high: row.low_blocks_high }
        : { high_blocks_low: row.high_blocks_low }),
    }));
    return {
      contact_pairs: exportRows(pairs),
      contact_commands: exportRows(
        rowsOf(
          await tx.execute(
            sql`select * from contact_commands where actor_id=${actorId} order by created_at,request_id`,
          ),
        ),
      ),
      // Only the subject's own requests and declines: others' stay theirs.
      social_requests: exportRows(
        rowsOf(
          await tx.execute(
            sql`select * from social_requests where actor_id=${actorId} order by created_at,request_id`,
          ),
        ),
      ),
      social_request_declines: exportRows(
        rowsOf(
          await tx.execute(
            sql`select * from social_request_declines where decliner_actor_id=${actorId} order by requester_actor_id`,
          ),
        ),
      ),
    };
  },
};
