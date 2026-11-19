import { sql } from 'drizzle-orm';
import { normalizedEmailSql } from './email-identity';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { scopeTransaction } from './tenant-scope';
import type { Tx } from './tx';

const page = 100;

/** Runs `work` under each club's own scope (club tables are tenant-fenced), then clears the scope. */
async function eachClub(
  tx: Tx,
  work: (organizationId: string) => Promise<void>,
) {
  let after = '';
  try {
    for (;;) {
      const clubs = (await tx.execute(sql`select id from organizations
        where kind in ('school', 'family') and id > ${after} order by id limit ${page}`)) as unknown as {
        id: string;
      }[];
      for (const club of clubs) {
        await scopeTransaction(tx, { organizationId: club.id });
        await work(club.id);
      }
      if (clubs.length < page) return;
      after = clubs.at(-1)!.id;
    }
  } finally {
    await scopeTransaction(tx, {});
  }
}

const subjectEmail = (userId: string) =>
  sql`(select ${normalizedEmailSql(sql`email`)} from users where id = ${userId})`;

/**
 * Club seats and seat invitations (ADR 0148). Erasure gives up the subject's
 * seat (their seat grants go with the entitlement adopter) and deletes every
 * invitation addressed to their email, with its unsent mail; it runs before
 * the address is cleared. Export returns their seat and those invitations.
 */
export const clubSeatPrivacyAdopter: PrivacyAdopter = {
  id: 'club-seats',
  phase: 'before-auth',
  erase: async (tx, subject) => {
    await eachClub(tx, async (organizationId) => {
      await tx.execute(
        sql`delete from club_seats where organization_id=${organizationId} and user_id=${subject.userId}`,
      );
      await tx.execute(sql`update mail_intents set state='cancelled', last_error_code='recipient-gone',
          completed_at=clock_timestamp(), lease_token_digest=null, lease_expires_at=null
        where state in ('queued', 'leased') and club_seat_invitation_id in (
          select id from club_seat_invitations where organization_id=${organizationId}
            and email = ${subjectEmail(subject.userId)})`);
      await tx.execute(sql`delete from club_seat_invitations
        where organization_id=${organizationId} and email = ${subjectEmail(subject.userId)}`);
    });
  },
  export: async (tx, subject) => {
    const seats: Record<string, unknown>[] = [];
    const invitations: Record<string, unknown>[] = [];
    await eachClub(tx, async (organizationId) => {
      seats.push(
        ...(await tx.execute(sql`select organization_id,
            to_char(assigned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as assigned_at
          from club_seats where organization_id=${organizationId} and user_id=${subject.userId}`)),
      );
      invitations.push(
        ...(await tx.execute(sql`select id, organization_id, email,
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
            to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at
          from club_seat_invitations where organization_id=${organizationId}
            and email = ${subjectEmail(subject.userId)}`)),
      );
    });
    return {
      club_seats: seats,
      club_seat_invitations: exportRows(invitations),
    };
  },
};
