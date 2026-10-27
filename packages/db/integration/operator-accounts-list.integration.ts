import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture, withDatabase } from './constraint-helpers';
import { pendingAccount } from './operator-accounts.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('operator account listing (ADR 0079)', () => {
  test('accounts list newest first in stable keyset pages', async () => {
    await withFixture(url, async (fixture) => {
      const accounts: string[] = [];
      for (const minute of [1, 2, 3]) {
        const { userId } = await pendingAccount(fixture);
        await fixture.sql`update account_beta_access set requested_at = ${`2001-01-01T00:0${minute}:00.000Z`}::timestamptz where user_id = ${userId}`;
        accounts.push(userId);
      }
      await withDatabase(url, async (database) => {
        const first = await database.listOperatorAccounts({
          access: 'pending',
          limit: 2,
          after: {
            requestedAt: '2001-01-01T00:04:00.000Z',
            userId: 'z'.repeat(24),
          },
        });
        const last = first.at(-1)!;
        const second = await database.listOperatorAccounts({
          access: 'pending',
          limit: 2,
          after: { requestedAt: last.requestedAt, userId: last.userId },
        });
        assert({
          given: 'three pending accounts requested a minute apart',
          should: 'page newest first with no overlap',
          actual: [
            first.map((row) => row.userId),
            second
              .filter((row) => accounts.includes(row.userId))
              .map((row) => row.userId),
          ],
          expected: [[accounts[2], accounts[1]], [accounts[0]]],
        });
      });
    });
  });

  test('keyset pages keep microsecond order across a page boundary', async () => {
    await withFixture(url, async (fixture) => {
      const accounts: string[] = [];
      // Two requests in the same millisecond, then an older one.
      for (const at of [
        '2001-01-02T11:00:00.000000Z',
        '2001-01-02T12:00:00.123400Z',
        '2001-01-02T12:00:00.123456Z',
      ]) {
        const { userId } = await pendingAccount(fixture);
        await fixture.sql`update account_beta_access set requested_at = ${at}::timestamptz where user_id = ${userId}`;
        accounts.push(userId);
      }
      await withDatabase(url, async (database) => {
        const seen: string[] = [];
        let after = {
          requestedAt: '2001-01-03T00:00:00.000000Z',
          userId: 'z'.repeat(24),
        };
        for (let page = 0; page < 3; page++) {
          const [row] = await database.listOperatorAccounts({
            access: 'pending',
            limit: 1,
            after,
          });
          if (!row) break;
          seen.push(row.userId);
          after = { requestedAt: row.requestedAt, userId: row.userId };
        }
        assert({
          given:
            'two pending requests a few microseconds apart in one millisecond, paged one at a time',
          should:
            'return every account exactly once, newest first, with a cursor that keeps microseconds',
          actual: seen,
          expected: [accounts[2], accounts[1], accounts[0]],
        });
      });
    });
  });
});
