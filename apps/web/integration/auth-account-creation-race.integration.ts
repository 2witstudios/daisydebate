import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createFlows, tokenOf } from './auth-mounted-flows';
import { counts } from './auth-mounted-helpers';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
const { requestLink, redeem, fresh } = await createFlows();

describe('AUTH-6.3 concurrent account creation', () => {
  test('two brand-new tokens for the same never-before-seen email create exactly one user account', async () => {
    // Distinct from a replay race (one token redeemed many times): these are
    // two genuinely separate, valid tokens from two separate requests for a
    // new address, racing to create the account for the first time. The
    // guarantee under test is user-creation dedup, not single-use
    // token consumption.
    const email = fresh();
    const first = await requestLink(email);
    const second = await requestLink(email);
    const results = await Promise.all([
      redeem(tokenOf(first.link as URL)),
      redeem(tokenOf(second.link as URL)),
    ]);
    const cookies = (result: Response) => result.headers.getSetCookie().length;
    const winners = results.filter((result) => cookies(result) > 0);
    const losers = results.filter((result) => cookies(result) === 0);
    const loserBody = losers.length > 0 ? await losers[0]?.text() : '';
    // A real user-creation race under the database's unique email
    // constraint: exactly one redemption wins a session; the other must fail
    // safely (a retryable 503 with no SQL/detail leak, never a crash, a
    // partial write, or a second user row) rather than succeeding twice.
    assert({
      given:
        'two distinct valid tokens for the same new email redeemed concurrently',
      should:
        'authenticate exactly one and fail the other safely, with no duplicate account',
      actual: {
        winners: winners.length,
        loserStatus: losers[0]?.status,
        loserLeaksDetail: /insert into|params:|\$1/i.test(loserBody ?? ''),
        counts: await counts(email),
      },
      expected: {
        winners: 1,
        loserStatus: 503,
        loserLeaksDetail: false,
        counts: { users: 1, sessions: 1, verifications: 0 },
      },
    });
  });
});
