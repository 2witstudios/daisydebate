import { assert, setupRitewayBun, test } from 'riteway/bun';
import { shareNoticeOf, standingBadgeOf } from './release-words';

setupRitewayBun();

test('release words', () => {
  assert({
    given: 'each share outcome key',
    should: 'say nothing on success and the reason otherwise',
    actual: [
      shareNoticeOf(''),
      shareNoticeOf('shared'),
      shareNoticeOf('releases_missing'),
      shareNoticeOf('constructor'),
    ],
    expected: [
      null,
      null,
      'Every youth debater needs a media release first.',
      'This recording could not be shared. Try again.',
    ],
  });
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
