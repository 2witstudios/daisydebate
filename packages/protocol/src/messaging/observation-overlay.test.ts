import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  assertObservableReactionPolicy,
  observationChannelOverlaySchema,
} from './observation-channel';
import { observationOverlaySchema } from '../observation-messages';
setupRitewayBun();
test('the own-reactions overlay names messages and reactions only', () => {
  const own = { messageId: 'e'.repeat(24), reaction: 'up' };
  assert({
    given: 'an own reaction, an extra field and a malformed message id',
    should: 'accept only the bounded actor-private shape',
    actual: [
      observationChannelOverlaySchema.safeParse({ ownReactions: [own] })
        .success,
      observationChannelOverlaySchema.safeParse({
        ownReactions: [{ ...own, actorId: 'a'.repeat(24) }],
      }).success,
      observationChannelOverlaySchema.safeParse({
        ownReactions: [{ ...own, messageId: 'x' }],
      }).success,
    ],
    expected: [true, false, false],
  });
});
test('the largest valid own-reactions overlay fits the overlay byte bound', () => {
  const worst = {
    ownReactions: Array.from({ length: 400 }, (_, index) => ({
      messageId: index.toString(36).padStart(24, 'z'),
      reaction: '\u0001'.repeat(16),
    })),
  };
  assert({
    given:
      'the most and longest escaped own reactions the channel schema allows, and one more',
    should:
      'accept the largest within the generic overlay bound and refuse more entries',
    actual: [
      observationChannelOverlaySchema.safeParse(worst).success,
      observationOverlaySchema.safeParse(worst).success,
      observationChannelOverlaySchema.safeParse({
        ownReactions: [...worst.ownReactions, worst.ownReactions[0]],
      }).success,
    ],
    expected: [true, true, false],
  });
});
test('a reaction policy must fit the own-reactions overlay contract', () => {
  const refusal = (policy: { reactionUnits: number; choices: string[] }) => {
    try {
      assertObservableReactionPolicy(policy);
      return 'accepted';
    } catch (error) {
      return (error as Error).message;
    }
  };
  const eight = Array.from({ length: 8 }, (_, index) => `r${index}`);
  assert({
    given: 'eight short choices, nine choices, and 17-unit reactions',
    should: 'accept only policies whose every own overlay fits its schema',
    actual: [
      refusal({ reactionUnits: 16, choices: eight }),
      refusal({ reactionUnits: 8, choices: [...eight, 'r8'] }),
      refusal({ reactionUnits: 17, choices: ['up'] }),
    ],
    expected: [
      'accepted',
      'Reaction policy exceeds the observation overlay contract',
      'Reaction policy exceeds the observation overlay contract',
    ],
  });
});
