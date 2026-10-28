import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import {
  exportRows,
  ownedTableExpectedColumns,
  ownedTablePrivacyFields,
} from '../privacy/owned-tables';

const contactsColumns = {
  contact_pairs: {
    identifier: [],
    personal: [
      'low_actor_id',
      'high_actor_id',
      'low_blocks_high',
      'high_blocks_low',
    ],
    none: ['revision'],
  },
  contact_commands: {
    identifier: ['request_id'],
    personal: ['actor_id', 'counterpart_actor_id', 'digest'],
    none: ['kind', 'created_at'],
  },
  social_requests: {
    identifier: ['request_id'],
    personal: ['actor_id', 'counterpart_actor_id', 'unrelated'],
    none: ['kind', 'created_at'],
  },
  social_request_declines: {
    identifier: [],
    personal: [
      'decliner_actor_id',
      'requester_actor_id',
      'low_actor_id',
      'high_actor_id',
      'declined_count',
      'last_declined_at',
      'blocked_until',
      'expires_at',
    ],
    none: [],
  },
} as const;

const purposes: Readonly<Record<string, string>> = {
  contact_pairs: 'Member pair blocks and lock order',
  contact_commands: 'Contact command dedupe',
  social_requests: 'Social request budget',
  social_request_declines: 'Social request decline block',
};

export const contactsPrivacyExpectedColumns =
  ownedTableExpectedColumns(contactsColumns);

const retentions: Readonly<
  Record<string, { readonly decision: string; readonly rule: string }>
> = {
  social_request_declines: {
    decision: 'dvkpb5wjay835m0xrgq1iz6v',
    rule: '30 days after the last decline (DEC-251), or sooner on acceptance, pair deletion or erasure',
  },
  social_requests: {
    decision: 'xidjgsvnu3spoaa35dzzkkn5',
    rule: 'once older than the 24-hour request budget window (DEC-259), or sooner on erasure',
  },
};

/** DEC-251 sets the request and decline windows; other tables await theirs. */
export const contactsPrivacyFields = ownedTablePrivacyFields({
  owner: 'CONTACTS',
  columns: contactsColumns,
  purpose: (table) => purposes[table]!,
  retention: (table) => {
    const approved = retentions[table];
    return approved === undefined
      ? { status: 'pending', decision: 'njiorsf64z4iqjm2dbfa3zuu' }
      : { status: 'approved', ...approved };
  },
});

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/**
 * Contacts' subject rights, run after every capability built on the pair
 * has removed its own rows: the subject's pairs, receipts, requests and
 * declines go; export returns only the subject's own side of each.
 */
export const contactsPrivacyAdopter: PrivacyAdopter = {
  id: 'contacts',
  phase: 'after-scrub',
  fields: contactsPrivacyFields,
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
