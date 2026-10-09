import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingCoreSchemas, type MessagingCoreBounds } from '../index';

setupRitewayBun();

// DEC-124 is provisional: these bounds are injected, never production defaults.
const bounds: MessagingCoreBounds = {
  messageUnits: 4000,
  pageItems: 100,
};
const schemas = createMessagingCoreSchemas(bounds);
const channelId = 'c'.repeat(24);
const requestId = 'r'.repeat(24);
const messageId = 'm'.repeat(24);
const send = { version: 1, channelId, requestId, text: '  Hello 🌼  ' };

test('send preserves text and refuses malformed or oversized input', () => {
  assert({
    given: 'valid send text with surrounding whitespace',
    should: 'preserve the original value',
    actual: schemas.send.parse(send).text,
    expected: send.text,
  });
  const cases = [
    [send, true],
    [{ ...send, text: '😀'.repeat(2000) }, true],
    [{ ...send, text: '😀'.repeat(2000) + 'a' }, false],
    [{ ...send, text: ' \n\t' }, false],
    [{ ...send, channelId: 'invalid' }, false],
    [{ ...send, requestId: 'invalid' }, false],
    [{ ...send, version: 2 }, false],
    [{ ...send, actorId: requestId }, false],
    [{ ...send, audience: 'all' }, false],
    [{ ...send, replyToMessageId: messageId }, true],
  ] as const;
  for (const [input, expected] of cases)
    assert({
      given: JSON.stringify(input),
      should: 'validate only the portable send contract',
      actual: schemas.send.safeParse(input).success,
      expected,
    });
});

test('history and changes use distinct channel-bound cursors with explicit limits', () => {
  const cases = [
    [
      schemas.history,
      { version: 1, channelId, limit: 100, before: { channelId, sequence: 2 } },
      true,
    ],
    [schemas.history, { version: 1, channelId, limit: 1 }, true],
    [schemas.history, { version: 1, channelId }, false],
    [schemas.history, { version: 1, channelId, limit: 101 }, false],
    [schemas.history, { version: 1, channelId, limit: 1.5 }, false],
    [
      schemas.history,
      {
        version: 1,
        channelId,
        limit: 1,
        before: { channelId: requestId, sequence: 2 },
      },
      false,
    ],
    [
      schemas.history,
      {
        version: 1,
        channelId,
        limit: 1,
        before: { channelId, changeVersion: 2 },
      },
      false,
    ],
    [
      schemas.changes,
      {
        version: 1,
        channelId,
        limit: 1,
        after: { channelId, changeVersion: 0 },
      },
      true,
    ],
    [
      schemas.changes,
      {
        version: 1,
        channelId,
        limit: 1,
        after: { channelId, changeVersion: -1 },
      },
      false,
    ],
    [
      schemas.changes,
      {
        version: 1,
        channelId,
        limit: 1,
        after: { channelId, changeVersion: Number.MAX_SAFE_INTEGER + 1 },
      },
      false,
    ],
  ] as const;
  for (const [schema, input, expected] of cases)
    assert({
      given: JSON.stringify(input),
      should: 'reject invalid ordering or cross-channel cursors',
      actual: schema.safeParse(input).success,
      expected,
    });
});

test('history envelopes reject foreign channels and invalid sequence order', () => {
  const message = {
    id: messageId,
    channelId,
    authorActorId: requestId,
    sequence: 1,
    changeVersion: 1,
    text: 'Hello',
    createdAt: '2026-10-09T17:00:00.000Z',
    editedAt: null,
  };
  const valid = {
    version: 1,
    channelId,
    changeVersion: 2,
    messages: [message],
    nextBefore: null,
  };
  for (const [patch, expected] of [
    [{}, true],
    [{ messages: [{ ...message, channelId: requestId }] }, false],
    [{ messages: [message, message] }, false],
    [{ messages: [{ ...message, changeVersion: 3 }] }, false],
    [{ messages: [{ ...message, sequence: 0 }] }, false],
    [{ messages: [{ ...message, createdAt: 'yesterday' }] }, false],
    [{ nextBefore: { channelId: requestId, sequence: 1 } }, false],
  ] as const)
    assert({
      given: JSON.stringify(patch),
      should: 'accept only consistent history envelopes',
      actual: schemas.historyResult.safeParse({ ...valid, ...patch }).success,
      expected,
    });
});

test('change envelopes separate deletion from text and maintain increasing versions', () => {
  const deletion = { kind: 'removed', channelId, messageId, changeVersion: 2 };
  const valid = {
    version: 1,
    channelId,
    changeVersion: 2,
    changes: [deletion],
    nextAfter: { channelId, changeVersion: 2 },
  };
  for (const [patch, expected] of [
    [{}, true],
    [{ changes: [{ ...deletion, text: 'deleted content' }] }, false],
    [{ changes: [{ ...deletion, channelId: requestId }] }, false],
    [{ changes: [deletion, deletion] }, false],
    [{ changes: [{ ...deletion, changeVersion: 3 }] }, false],
    [{ nextAfter: { channelId, changeVersion: 3 } }, false],
  ] as const)
    assert({
      given: JSON.stringify(patch),
      should: 'accept only consistent content-scoped change envelopes',
      actual: schemas.changesResult.safeParse({ ...valid, ...patch }).success,
      expected,
    });
});
