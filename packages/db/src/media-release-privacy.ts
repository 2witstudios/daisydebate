import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from './authorization';
import { endPublicationsOf } from './media-release-records';
import type { PrivacyAdopter } from './privacy/contracts';
import { exportRows } from './privacy/export-rows';
import { scopeTransaction } from './tenant-scope';

type Tx = AuthorizationTransaction;
const page = 100;
const at = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

const read = async (tx: Tx, query: ReturnType<typeof sql>) =>
  (await tx.execute(query)) as unknown as Record<string, unknown>[];

/** Runs `work` under each club's own scope (attestations are club rows), then clears it. */
async function eachClub(
  tx: Tx,
  work: (organizationId: string) => Promise<void>,
) {
  let after = '';
  try {
    for (;;) {
      const clubs = (await read(
        tx,
        sql`select id from organizations where kind in ('school', 'family')
          and id > ${after} order by id limit ${page}`,
      )) as { id: string }[];
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

/**
 * Media releases (ADR 0151). Erasing a minor ends their releases (withdrawn
 * by erasure, kept as consent evidence for what was already public) and every
 * public Youth Recording they debated in, and deletes their requests (with
 * the parent's address, links and mail) and their asks to clubs. Erasing a
 * club's staff member keeps the club's attestation but drops their name and
 * account from it. Export returns the minor's requests, releases and asks.
 */
export const mediaReleasePrivacyAdopter: PrivacyAdopter = {
  id: 'media-releases',
  phase: 'before-auth',
  erase: async (tx, subject) => {
    // The minor's account row orders every release command about them, so a
    // co-debater's share either commits first (and is ended below) or waits
    // and then finds the releases withdrawn.
    await tx.execute(
      sql`select 1 from users where id = ${subject.userId} for update`,
    );
    await tx.execute(
      sql`update media_releases set withdrawn_at = clock_timestamp(),
          withdrawn_by = 'erasure'
        where user_id = ${subject.userId} and withdrawn_at is null`,
    );
    await endPublicationsOf(tx, subject.userId);
    await tx.execute(
      sql`delete from media_release_requests where user_id = ${subject.userId}`,
    );
    await tx.execute(
      sql`delete from media_release_club_asks where user_id = ${subject.userId}`,
    );
    await eachClub(tx, async (organizationId) => {
      await tx.execute(
        sql`update media_release_club_attestations
          set attested_by_user_id = null, attester_name = 'Former club staff'
          where organization_id = ${organizationId}
            and attested_by_user_id = ${subject.userId}`,
      );
    });
  },
  export: async (tx, subject) => ({
    media_release_requests: exportRows(
      await read(
        tx,
        sql`select id, recipient_email, ${at('requested_at')} as requested_at,
            ${at('expires_at')} as expires_at, outcome,
            ${at('resolved_at')} as resolved_at
          from media_release_requests where user_id = ${subject.userId}
          order by requested_at, id`,
      ),
    ),
    media_releases: exportRows(
      await read(
        tx,
        sql`select id, scope, source, signer_name, signer_relation,
            wording_version, ${at('signed_at')} as signed_at,
            ${at('withdrawn_at')} as withdrawn_at, withdrawn_by
          from media_releases where user_id = ${subject.userId}
          order by signed_at, id`,
      ),
    ),
    media_release_club_asks: exportRows(
      await read(
        tx,
        sql`select id, organization_id, ${at('asked_at')} as asked_at
          from media_release_club_asks where user_id = ${subject.userId}
          order by asked_at, id`,
      ),
    ),
  }),
};
