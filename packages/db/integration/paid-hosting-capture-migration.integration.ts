import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261118113413_paid_hosting_capture';
const scratch = scratchDatabase(url, 'paidcapturemig');

afterAll(() => scratch.drop());

test(
  'the migration moves an existing capture admission’s grant into its basis and keeps it valid (ADR 0147)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const sql = new SQL(scratch.url, { max: 1 });
    try {
      const ids = Object.fromEntries(
        [
          'admission',
          'round',
          'room',
          'lobby',
          'fixture',
          'sponsor',
          'version',
          'official',
          'actor',
          'command',
          'event',
        ].map((name) => [name, createId()]),
      );
      const admittedAt = '2026-11-18T12:00:00.000Z',
        deadlineAt = '2026-11-18T13:00:00.000Z';
      const grant = {
        entitlement: 'tournament_hosting',
        source: 'administrative',
        hosting: { id: ids.version, userId: ids.sponsor },
      };
      const admission = {
        id: ids.admission,
        roundId: ids.round,
        roomId: ids.room,
        lobbyId: ids.lobby,
        eventId: ids.event,
        fixtureId: ids.fixture,
        commandId: ids.command,
        funding: { kind: 'personal-owner', ownerUserId: ids.sponsor },
        grant,
        official: { userId: ids.official, actorId: ids.actor },
        admittedAt,
        deadlineAt,
      };
      // The row as the earlier schema stored it. Its parents are not the
      // subject, so the seed alone runs with foreign keys and triggers off.
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`insert into tournament_capture_admissions
          (id, round_id, room_id, lobby_id, fixture_id, sponsor_user_id, hosting_version_id,
           official_user_id, official_actor_id, command_id, admission, deadline_at, created_at)
          values (${ids.admission}, ${ids.round}, ${ids.room}, ${ids.lobby}, ${ids.fixture},
            ${ids.sponsor}, ${ids.version}, ${ids.official}, ${ids.actor}, ${ids.command},
            ${admission}, ${deadlineAt}, ${admittedAt})`;
      });
      await scratch.migrate((folder) => folder <= migration);
      const [row] = await sql`
        select admission, hosting_version_id, hosting_purchase_id
          from tournament_capture_admissions where id = ${ids.admission}`;
      const [constraint] = await sql`
        select convalidated from pg_constraint
         where conname = 'tournament_capture_admissions_identity'`;
      assert({
        given: 'an admission stored with a top-level grant',
        should:
          'name it as a grant basis, keep its grant version column and satisfy the new identity check',
        actual: {
          grant: row?.admission.grant,
          basis: row?.admission.basis,
          version: row?.hosting_version_id,
          purchase: row?.hosting_purchase_id,
          validated: constraint?.convalidated,
        },
        expected: {
          grant: undefined,
          basis: { kind: 'grant', grant },
          version: ids.version,
          purchase: null,
          validated: true,
        },
      });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
