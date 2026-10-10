import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingReactionSchemas } from './reactions';
setupRitewayBun();
const policy = { reactionUnits: 8, choices: ['👍', '❤️'] };
const intent = {
  version: 1,
  channelId: 'c'.repeat(24),
  messageId: 'm'.repeat(24),
  requestId: 'r'.repeat(24),
  reaction: '👍',
  active: true,
};
test('reaction contracts require explicit choices and strict scoped mutation intent', () => {
  const schema = createMessagingReactionSchemas(policy);
  assert({
    given:
      'configured choices and untrusted actor, scope or unsupported reaction input',
    should:
      'accept only complete owned-operation intent without deriving an actor or a default choice',
    actual: [
      schema.command.safeParse(intent).success,
      ...[
        { ...intent, actorId: 'a'.repeat(24) },
        { ...intent, reaction: '😂' },
        { ...intent, reaction: ' 👍 ' },
        { ...intent, active: undefined },
        { ...intent, messageId: 'foreign' },
        { ...intent, requestId: '' },
      ].map((input) => schema.command.safeParse(input).success),
    ],
    expected: [true, false, false, false, false, false, false],
  });
});
test('reaction result contains only authorized aggregate state and scoped retry metadata', () => {
  const schema = createMessagingReactionSchemas(policy);
  const result = {
    version: 1,
    channelId: intent.channelId,
    messageId: intent.messageId,
    changeVersion: 2,
    replayed: false,
    reactions: [{ reaction: '👍', count: 2, own: true }],
  };
  assert({
    given:
      'current aggregate counts with invalid personal actor detail, duplicates or counters',
    should:
      'validate a thin response without actor lists or duplicate summaries',
    actual: [
      schema.result.safeParse(result).success,
      ...[
        {
          ...result,
          reactions: [{ ...result.reactions[0], actorId: 'a'.repeat(24) }],
        },
        { ...result, reactions: [result.reactions[0], result.reactions[0]] },
        { ...result, reactions: [{ reaction: '👍', count: 0, own: false }] },
        { ...result, changeVersion: -1 },
      ].map((input) => schema.result.safeParse(input).success),
    ],
    expected: [true, false, false, false, false],
  });
});

test('retained own reactions remain removable after the approved additions change', () => {
  const schema = createMessagingReactionSchemas(policy);
  assert({
    given: 'a retained choice outside current explicit additions',
    should: 'validate only removal intent without allowing that new addition',
    actual: [
      schema.command.safeParse({ ...intent, reaction: '😂', active: false })
        .success,
      schema.command.safeParse({ ...intent, reaction: '😂', active: true })
        .success,
    ],
    expected: [true, false],
  });
});
