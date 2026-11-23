import { releaseWithdrawers } from '@daisy/protocol/media-release';
import { organizationKinds } from '@daisy/protocol/lobby';
import { listedWord, listedWords } from './lifecycle-sql';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows, query, run } from './raw-rows';
import { scopeTransaction } from './tenant-scope';
import type { Tx } from './tx';
import { z } from 'zod';

const page = 100;
const at = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

/** Runs `work` under each club's own scope (attestations are club rows), then clears it. */
async function eachClub(
  tx: Tx,
  work: (organizationId: string) => Promise<void>,
) {
  let after = '';
  try {
    for (;;) {
      const clubs = await query(
        tx,
        z.object({ id: z.string() }),
        sql`select id from organizations where kind in ${listedWords(organizationKinds, ['school', 'family'])}
          and id > ${after} order by id limit ${page}`,
      );
      for (const club of clubs) {
        await scopeTransaction(tx, { organizationId: club.id });
        await work(club.id);
      }
      if (clubs.length < page) return;
      after = clubs[clubs.length - 1]!.id;
    }
  } finally {
    await scopeTransaction(tx, {});
  }
}

/**
 * Media releases (ADR 0151). Erasing a minor ends their releases (withdrawn
 * by erasure, kept as consent evidence for what was already reused), and
 * deletes their requests (with
 * the parent's address, links and mail) and their asks to clubs. Erasing a
 * club's staff member keeps the club's attestation but drops their name and
 * account from it. Export returns the minor's requests, releases and asks.
 */
export const mediaReleasePrivacyAdopter: PrivacyAdopter = {
  id: 'media-releases',
  phase: 'before-auth',
  erase: async (tx, subject) => {
    // The minor's account row orders every release command about them.
    await run(
      tx,
      sql`select 1 from users where id = ${subject.userId} for update`,
    );
    await run(
      tx,
      sql`update media_releases set withdrawn_at = clock_timestamp(),
          withdrawn_by = ${listedWord(releaseWithdrawers, 'erasure')}
        where user_id = ${subject.userId} and withdrawn_at is null`,
    );
    await run(
      tx,
      sql`delete from media_release_requests where user_id = ${subject.userId}`,
    );
    await run(
      tx,
      sql`delete from media_release_club_asks where user_id = ${subject.userId}`,
    );
    await eachClub(tx, async (organizationId) => {
      await run(
        tx,
        sql`update media_release_club_attestations
          set attested_by_user_id = null, attester_name = 'Former club staff'
          where organization_id = ${organizationId}
            and attested_by_user_id = ${subject.userId}`,
      );
    });
  },
  export: async (tx, subject) => ({
    media_release_requests: exportRows(
      await query(
        tx,
        z.object({
          id: z.string(),
          recipient_email: z.string(),
          requested_at: z.string(),
          expires_at: z.string(),
          outcome: z.string().nullable(),
          resolved_at: z.string().nullable(),
        }),
        sql`select id, recipient_email, ${at('requested_at')} as requested_at,
            ${at('expires_at')} as expires_at, outcome,
            ${at('resolved_at')} as resolved_at
          from media_release_requests where user_id = ${subject.userId}
          order by requested_at, id`,
      ),
    ),
    media_releases: exportRows(
      await query(
        tx,
        z.object({
          id: z.string(),
          scope: z.string(),
          source: z.string(),
          signer_name: z.string().nullable(),
          signer_relation: z.string().nullable(),
          wording_version: z.string().nullable(),
          signed_at: z.string(),
          withdrawn_at: z.string().nullable(),
          withdrawn_by: z.string().nullable(),
        }),
        sql`select id, scope, source, signer_name, signer_relation,
            wording_version, ${at('signed_at')} as signed_at,
            ${at('withdrawn_at')} as withdrawn_at, withdrawn_by
          from media_releases where user_id = ${subject.userId}
          order by signed_at, id`,
      ),
    ),
    media_release_club_asks: exportRows(
      await query(
        tx,
        z.object({
          id: z.string(),
          organization_id: z.string(),
          asked_at: z.string(),
        }),
        sql`select id, organization_id, ${at('asked_at')} as asked_at
          from media_release_club_asks where user_id = ${subject.userId}
          order by asked_at, id`,
      ),
    ),
  }),
};
