import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { accountAgeFact } from './account-age';
setupRitewayBun();
const source = {
  birthMonth: '2010-10',
  revision: 2,
  recordedAt: '2026-01-01T00:00:00.000Z',
};
const account = {
  userId: 'u',
  actorId: 'a',
  member: true,
  erased: false,
  revision: 3,
};
describe('account age facts', () => {
  test('durable fact is bounded by the next trusted UTC month', () => {
    assert({
      given: 'a durable birthmonth at a band transition',
      should: 'derive only a current minimal age fact',
      actual: accountAgeFact({
        source,
        account,
        now: '2026-10-01T00:00:00.000Z',
      }),
      expected: {
        state: 'known',
        actorId: 'a',
        band: '16-17',
        revision: 2,
        accountRevision: 3,
        validUntil: '2026-11-01T00:00:00.000Z',
      },
    });
  });
  test('missing malformed future and erased sources are unknown', () => {
    assert({
      given: 'absent, invalid, future or erased authority',
      should: 'grant no inferred eligibility',
      actual: [
        null,
        { ...source, birthMonth: 'nope' },
        { ...source, birthMonth: '2027-01' },
        { ...source, revision: 0 },
      ]
        .map(
          (source) =>
            accountAgeFact({ source, account, now: '2026-10-01T00:00:00.000Z' })
              .state,
        )
        .concat(
          accountAgeFact({
            source,
            account: { ...account, erased: true },
            now: '2026-10-01T00:00:00.000Z',
          }).state,
        ),
      expected: Array(5).fill('unknown'),
    });
  });
});
