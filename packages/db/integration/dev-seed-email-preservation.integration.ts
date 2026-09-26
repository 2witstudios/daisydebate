import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { applyDevSeed } from '../src/dev-seed';
import { snapshotFor } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const userId = 'z1x2c3v4b5n6m7a8s9d0f1g2';
const actorId = 'h3j4k5l6q7w8e9r0t1y2u3i4';
const debateId = 'o5p6a7s8d9f0g1h2j3k4l5z6';
const resolution = 'Resolved: a reseed must not wipe an unrelated field.';

const seedWith = (person: {
  readonly email?: string;
  readonly emailVerified?: boolean;
}) =>
  applyDevSeed({
    url,
    seed: {
      name: 'email-preservation-test',
      version: '1',
      people: [{ userId, actorId, username: 'preservation-tester', ...person }],
      debate: {
        id: debateId,
        createdBy: actorId,
        resolution,
        format: 'foundation',
        mode: 'practice',
        visibility: 'private',
        snapshot: snapshotFor(debateId, { resolution }),
      },
    },
  });

describe('AUTH-7.6 review: applyDevSeed preserves email/emailVerified it does not specify', () => {
  test('a reseed with no email/emailVerified keeps a value set on an earlier run', async () => {
    const database = new SQL(url, { max: 1 });
    try {
      await seedWith({ email: 'kept@example.test', emailVerified: true });
      // A reseed of the same entry, this time omitting both fields.
      await seedWith({});
      const [row] = await database`
        select email, email_verified from users where id = ${userId}
      `;

      assert({
        given: 'a seed entry rerun without email/emailVerified',
        should:
          'preserve the value an earlier run set, not wipe it to null/false',
        actual: row,
        expected: { email: 'kept@example.test', email_verified: true },
      });

      await seedWith({ email: 'changed@example.test', emailVerified: false });
      const [changed] = await database`
        select email, email_verified from users where id = ${userId}
      `;
      assert({
        given: 'a seed entry rerun that does specify both fields',
        should: 'overwrite them to the new values',
        actual: changed,
        expected: { email: 'changed@example.test', email_verified: false },
      });
    } finally {
      try {
        await database`delete from debates where id = ${debateId}`;
        await database`delete from actors where id = ${actorId}`;
        await database`delete from users where id = ${userId}`;
        await database`delete from seed_versions where seed_name = 'email-preservation-test'`;
      } finally {
        await database.close();
      }
    }
  });
});
