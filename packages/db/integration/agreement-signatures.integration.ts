import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  agreementSignatureOperations,
  agreementSignaturePrivacyAdopter,
  readContentWaiverStanding,
} from '../src/agreement-signatures';
import { exportThenErase, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

const count = async (
  client: { unsafe: (query: string, values: unknown[]) => Promise<unknown> },
  userId: string,
) =>
  (
    (await client.unsafe(
      'select count(*)::int as c from agreement_signatures where user_id = $1',
      [userId],
    )) as { c: number }[]
  )[0]!.c;

/** An active season for the test; its signatures go with it. */
const withActiveSeason = async (
  client: { unsafe: (query: string, values?: unknown[]) => Promise<unknown> },
  run: (seasonId: string) => Promise<void>,
) => {
  const seasonId = createId();
  await client.unsafe(
    `insert into seasons (id, name, starts_at, status) values ($1, 'Waiver fixture', '2000-01-01T00:00:00Z', 'active')`,
    [seasonId],
  );
  try {
    await run(seasonId);
  } finally {
    await client.unsafe(
      'delete from agreement_signatures where season_id = $1',
      [seasonId],
    );
    await client.unsafe('delete from seasons where id = $1', [seasonId]);
  }
};

test('a signature records account, version, season and time, once', async () => {
  await withPrivacySubject(async ({ client, database, userId }) => {
    await withActiveSeason(client, async (seasonId) => {
      const agreements = agreementSignatureOperations({ database });
      const before = await agreements.readContentWaiverStanding(
        userId,
        'draft-1',
      );
      await agreements.signContentWaiver({
        id: createId(),
        userId,
        version: 'draft-1',
      });
      await agreements.signContentWaiver({
        id: createId(),
        userId,
        version: 'draft-1',
      });
      const [row] = (await client.unsafe(
        `select agreement, version, season_id, room_id, signed_at is not null as timed
       from agreement_signatures where user_id = $1`,
        [userId],
      )) as Record<string, unknown>[];
      assert({
        given: 'an unsigned member who signs twice',
        should: 'keep one row naming the agreement, version, season and time',
        actual: {
          before,
          after: await database.transaction((tx) =>
            readContentWaiverStanding(tx, userId, 'draft-1'),
          ),
          rows: await count(client, userId),
          row,
        },
        expected: {
          before: 'unsigned',
          after: 'signed',
          rows: 1,
          row: {
            agreement: 'ranked-content-waiver',
            version: 'draft-1',
            season_id: seasonId,
            room_id: null,
            timed: true,
          },
        },
      });
      assert({
        given: 'a newer version than the one signed',
        should: 'stand as unsigned',
        actual: await agreements.readContentWaiverStanding(userId, 'draft-2'),
        expected: 'unsigned',
      });
    });
  });
});

test('the scope follows the agreement', async () => {
  await withPrivacySubject(async ({ client, userId }) => {
    await withActiveSeason(client, async (seasonId) => {
      const insert = (agreement: string, season: unknown, room: unknown) =>
        client
          .unsafe(
            `insert into agreement_signatures (id, user_id, agreement, version, season_id, room_id, signed_at)
           values ($1, $2, $3, 'draft-1', $4, $5, now())`,
            [createId(), userId, agreement, season, room],
          )
          .then(
            () => 'stored',
            (error: Error) => error.message,
          );
      const results = await Promise.all([
        insert('ranked-content-waiver', null, null),
        insert('round-capture-notice', seasonId, null),
        insert('an-unknown-agreement', seasonId, null),
      ]);
      assert({
        given:
          'a waiver with no season, a notice with no Room, an unknown kind',
        should: 'refuse all three in the database',
        actual: results.map((result) => /_check/.test(result)),
        expected: [true, true, true],
      });
    });
  });
});

test('erasure keeps the signature as evidence, and export returns it', async () => {
  await withPrivacySubject(async ({ client, database, userId, actorId }) => {
    await withActiveSeason(client, async () => {
      await agreementSignatureOperations({ database }).signContentWaiver({
        id: createId(),
        userId,
        version: 'draft-1',
      });
      const exported = await exportThenErase(database, { userId, actorId }, [
        agreementSignaturePrivacyAdopter,
      ]);
      assert({
        given: 'a member who signed, then erases their account',
        should: 'export the signature and keep it',
        actual: [
          (exported.agreement_signatures as unknown[]).length,
          await count(client, userId),
        ],
        expected: [1, 1],
      });
    });
  });
});
