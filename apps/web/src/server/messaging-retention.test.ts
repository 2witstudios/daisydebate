import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retentionTargets } from './retention-sweep';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';

setupRitewayBun();

type Targets = Parameters<typeof retentionTargets>[0];

test('no retention target deletes messaging content by age (DEC-126, DEC-251)', () => {
  // Every purge the sweep may be handed answers nothing; only names matter.
  const database = new Proxy(
    {},
    { get: () => async () => 0 },
  ) as Targets['database'];
  const targets = retentionTargets({
    database,
    redis: { sweepOnlinePresence: async () => 0 },
    provisionalLinks: provisionalLinkPurposes,
  });
  assert({
    given: 'the production retention targets',
    should:
      'touch no message, channel or reaction: messages live until their author deletes them or is erased, and only spent DEC-251 decline blocks expire',
    actual: targets
      .filter(({ name }) => /messag|channel|reaction|social/i.test(name))
      .map(({ name }) => name),
    expected: ['retention.social_declines'],
  });
});
