import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationTransaction } from '../src/authorization';
import { erasePrivacySubject, type PrivacyAdopter } from '../src/privacy';
import { sqlStateOf } from './constraint-helpers';
import { bindings, now, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('subject account is locked before cleanup and adopters share the erasure transaction', async () => {
  await withPrivacySubject(async ({ database, userId, actorId, otherId }) => {
    const observer = new SQL(databaseUrl, { max: 1 });
    let firstTx: AuthorizationTransaction | null = null;
    let observed: unknown[] = [];
    const before: PrivacyAdopter = {
      id: 'lock-probe',
      phase: 'before-auth',
      fields: [],
      export: async () => ({}),
      erase: async (tx) => {
        firstTx = tx;
        const ownLock = await sqlStateOf(() =>
          observer.begin((inner) =>
            inner.unsafe('select id from users where id=$1 for update nowait', [
              userId,
            ]),
          ),
        );
        const otherLock = await sqlStateOf(() =>
          observer.begin((inner) =>
            inner.unsafe('select id from users where id=$1 for update nowait', [
              otherId,
            ]),
          ),
        );
        observed = [ownLock, otherLock];
      },
    };
    const after: PrivacyAdopter = {
      ...before,
      id: 'scrub-probe',
      phase: 'after-scrub',
      erase: async (tx) => {
        const rows = await tx.execute(
          sql`select email,email_verified,version,deleted_at is not null as erased from users where id=${userId}`,
        );
        const visible = await observer.unsafe(
          'select email,version,deleted_at is not null as erased from users where id=$1',
          [userId],
        );
        observed.push(
          tx === firstTx,
          (rows as unknown as unknown[])[0],
          visible[0]?.version,
          visible[0]?.erased,
        );
      },
    };
    const adopters = [before, after];
    try {
      await erasePrivacySubject(
        database,
        { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
        {
          requiredAdopters: adopters.map((item) => ({
            id: item.id,
            phase: item.phase,
            expectedColumns: {},
          })),
          adopters,
        },
        bindings,
      );
      assert({
        given: 'cleanup probes using a separate real database connection',
        should:
          'hold only subject account first and expose scrub only within the identical caller transaction before commit',
        actual: observed,
        expected: [
          '55P03',
          'accepted',
          true,
          { email: null, email_verified: false, version: 2, erased: true },
          1,
          false,
        ],
      });
    } finally {
      await observer.close();
    }
  });
});
