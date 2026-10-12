import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createMessagingReactionSchemas,
  MAX_MESSAGING_REACTION_CHOICES,
  MAX_MESSAGING_REACTION_UNITS,
} from './reactions';

setupRitewayBun();

test('a reaction policy stays inside the own-reaction overlay contract', () => {
  const accepts = (reactionUnits: number, choices: readonly string[]) => {
    try {
      createMessagingReactionSchemas({ reactionUnits, choices });
      return true;
    } catch {
      return false;
    }
  };
  const nine = Array.from({ length: 9 }, (_, i) => `r${i}`);
  assert({
    given: 'policies at and beyond 16 units per reaction and 8 choices',
    should:
      'accept the bounds and refuse anything an overlay would have to drop',
    actual: {
      bounds: [MAX_MESSAGING_REACTION_UNITS, MAX_MESSAGING_REACTION_CHOICES],
      atBounds: accepts(16, nine.slice(0, 8)),
      longUnits: accepts(17, ['ok']),
      manyChoices: accepts(16, nine),
    },
    expected: {
      bounds: [16, 8],
      atBounds: true,
      longUnits: false,
      manyChoices: false,
    },
  });
});
