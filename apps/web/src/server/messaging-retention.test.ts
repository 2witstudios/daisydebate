import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retentionTargets } from './retention-sweep';
import { provisionalLinkPurposes } from '../features/auth/mail/provisional-mail';

setupRitewayBun();

type Targets = Parameters<typeof retentionTargets>[0];

test('social messaging remains outside contextual retention (DEC-126, DEC-251)', () => {
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
      'touch no DM or group: social content lives until its author deletes it or is erased. Contextual spectator content expires after posting, floor content after Round end and Room chat after Room end, under their separate 180-day policies',
    actual: targets
      .filter(({ name }) =>
        /messag|channel|reaction|social|chat|floor/i.test(name),
      )
      .map(({ name }) => name),
    expected: [
      'retention.social_declines',
      'retention.social_requests',
      'retention.spectator_chat',
      'retention.audience_reactions',
      'retention.round_floor_receipts',
      'retention.round_floor_messages',
      'retention.round_floor_read_states',
      'retention.room_chat_receipts',
      'retention.room_chat_messages',
      'retention.room_chat_read_states',
    ],
  });
});
