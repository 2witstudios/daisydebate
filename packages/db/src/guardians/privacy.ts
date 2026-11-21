import { protectionLevelSchema } from '@daisy/protocol/protection-level';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PrivacyAdopter } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';
import { query, run } from '../raw-rows';
import { scopeTransaction } from '../tenant-scope';

const linkRow = z.object({
  id: z.string(),
  guardian_user_id: z.string(),
  minor_user_id: z.string(),
  activation: z.string().nullable(),
  activated_at: z.date().nullable(),
  closed_at: z.date().nullable(),
  status: z.string(),
});
const permissionRow = z.object({
  guardian_link_id: z.string(),
  lobby_id: z.string(),
});
const evidenceRow = z.object({
  id: z.string(),
  role: z.string(),
  method: z.string(),
  notice_kind: z.string(),
  notice_version: z.string(),
  notice_digest: z.string(),
  recorded_at: z.date(),
});

export const guardianLinksPrivacyAdopter: PrivacyAdopter = {
  id: 'guardian-links',
  phase: 'after-close',
  erase: async (tx, subject, { now }) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    await run(
      tx,
      sql`update child_account_requests
      set status = 'cancelled', closed_at = greatest(${now}::timestamptz, created_at, closed_at),
        email = null, first_name = null, birth_month = null
      where status in ('open', 'linked') and (
        guardian_user_id = ${subject.userId} or
        requested_link_id in (select id from guardian_links where minor_user_id = ${subject.userId})
      )`,
    );
    // The erasure timestamp can precede an activation that won the account lock.
    const closedAt = sql`greatest(${now}::timestamptz, created_at, activated_at, updated_at)`;
    await run(
      tx,
      sql`update guardian_links
      set status = case when status = 'active' then 'ended' else 'cancelled' end,
        version = version + 1, closed_at = ${closedAt}, updated_at = ${closedAt}
      where (guardian_user_id = ${subject.userId} or minor_user_id = ${subject.userId})
        and status in ('active', 'requested')`,
    );
    await run(tx, sql`select public.daisy_erase_protection_choice()`);
    await scopeTransaction(tx, {});
  },
  export: async (tx, subject) => {
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    const own = sql`guardian_user_id = ${subject.userId} or minor_user_id = ${subject.userId}`;
    const links = await query(
      tx,
      linkRow,
      sql`
      select id, guardian_user_id, minor_user_id, activation, activated_at, closed_at,
        case when status = 'refused' and guardian_user_id = ${subject.userId} then 'not-confirmed' else status end as status
      from guardian_links l where (${own})
        and (l.minor_user_id = ${subject.userId} or l.activated_at is not null or not exists (
          select 1 from child_account_requests r where r.requested_link_id = l.id
        ))
      order by id`,
    );
    const permissions = await query(
      tx,
      permissionRow,
      sql`
      select guardian_link_id, lobby_id from restriction_lobbies
      where ${own} order by guardian_link_id, lobby_id`,
    );
    const evidence = await query(
      tx,
      evidenceRow,
      sql`
      select id, role, case when role = 'guardian' then 'parental-consent' else method end as method,
        notice_kind, notice_version, notice_digest, recorded_at
      from guardian_consent_evidence where person_user_id = ${subject.userId} order by id`,
    );
    const protection = await query(
      tx,
      z.object({ choice: protectionLevelSchema }),
      sql`select choice from protection_levels where user_id = ${subject.userId}`,
    );
    await scopeTransaction(tx, {});
    return {
      protection_levels: exportRows(protection),
      guardian_links: exportRows(links),
      restriction_lobbies: exportRows(permissions),
      guardian_consent_evidence: exportRows(evidence),
    };
  },
};
