import { assert, setupRitewayBun, test } from 'riteway/bun';
import { standingBadgeOf } from './release-words';

setupRitewayBun();

test('release words', () => {
  assert({
    given: 'each standing',
    should: 'pick its badge',
    actual: [
      standingBadgeOf({ kind: 'none' }),
      standingBadgeOf({
        kind: 'withdrawn',
        release: {
          id: 'x',
          subjectUserId: 'm',
          scope: 'publish',
          attestation: {
            kind: 'parent',
            name: 'E',
            relation: 'parent',
            email: 'e@x.co',
          },
          wordingVersion: 'v',
          signedAt: '2026-11-01T00:00:00.000Z',
          withdrawnAt: '2026-11-02T00:00:00.000Z',
          withdrawnBy: 'parent',
        },
      }),
    ],
    expected: ['none', 'withdrawn'],
  });
});
