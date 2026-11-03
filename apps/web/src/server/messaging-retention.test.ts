import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retentionTargets } from './retention-sweep';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';

setupRitewayBun();

type Targets = Parameters<typeof retentionTargets>[0];

test('no retention target deletes private messaging content by age (DEC-126, DEC-251)', () => {
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
      'touch no DM, group, channel or reaction on one: those live until their author deletes them or is erased. Only spent DEC-251 decline blocks and request rows past the budget day expire, and the audience’s own spectator chat and reactions after 180 days',
    actual: targets
      .filter(({ name }) => /messag|channel|reaction|social|chat/i.test(name))
      .map(({ name }) => name),
    expected: [
      'retention.social_declines',
      'retention.social_requests',
      'retention.spectator_chat',
      'retention.audience_reactions',
    ],
  });
});
