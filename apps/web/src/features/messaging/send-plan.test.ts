import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { planMessageSend, sendPayloadDigest } from './send-plan';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const actorId = 'a'.repeat(24);
const messageId = 'm'.repeat(24);
const command = {
  version: 1 as const,
  channelId,
  requestId: 'r'.repeat(24),
  text: ' Hello ',
};
const counters = { channelId, messageSequence: 3, changeVersion: 8 };
const resources = { actorId, messageId, now: '2026-10-09T18:00:00.000Z' };
const context = { counters, receipt: null, existingMessage: null, reply: null };

test('an accepted send allocates independent ordering and one content-free change', () => {
  const before = JSON.stringify(context);
  const plan = planMessageSend(command, context, resources);
  assert({
    given: 'three messages and eight changes',
    should: 'allocate the fourth message and ninth change',
    actual:
      plan.kind === 'create'
        ? {
            sequence: plan.message.sequence,
            changeVersion: plan.message.changeVersion,
            text: plan.message.text,
            doorbell: plan.doorbell,
          }
        : plan.kind,
    expected: {
      sequence: 4,
      changeVersion: 9,
      text: ' Hello ',
      doorbell: { kind: 'channel.changed', channelId, changeVersion: 9 },
    },
  });
  assert({
    given: 'a pure send plan',
    should: 'leave the supplied state unchanged',
    actual: JSON.stringify(context),
    expected: before,
  });
});

test('receipts replay current available content without allocating another mutation', async () => {
  const original = planMessageSend(command, context, resources);
  if (original.kind !== 'create') throw new Error('Create fixture required');
  const saved = {
    ...original.message,
    text: 'Edited',
    changeVersion: 10,
    editedAt: resources.now,
    removedAt: null,
  };
  const retry = {
    ...context,
    receipt: { payloadDigest: sendPayloadDigest(command), messageId },
    existingMessage: saved,
  };
  assert({
    given: 'an equal original retry after editing',
    should:
      'return only the current message rather than saved original content',
    actual: planMessageSend(command, retry, {
      ...resources,
      messageId: 'n'.repeat(24),
    }),
    expected: { kind: 'replay', message: saved },
  });
  await assertRejects({
    given: 'an unequal payload with the same request key',
    should: 'conflict',
    actual: () =>
      planMessageSend({ ...command, text: 'Changed' }, retry, resources),
    code: 'CONFLICT',
  });
  for (const unavailable of [
    null,
    { ...saved, text: null, removedAt: resources.now },
  ])
    await assertRejects({
      given: 'a receipt whose content was removed or purged',
      should: 'refuse without recreating content',
      actual: () =>
        planMessageSend(
          command,
          { ...retry, existingMessage: unavailable },
          resources,
        ),
      code: 'NOT_FOUND',
    });
});

test('source-scoped replies and counters refuse without altering state', async () => {
  const original = planMessageSend(command, context, resources);
  if (original.kind !== 'create') throw new Error('Create fixture required');
  const reply = { ...original.message, removedAt: null };
  const replying = { ...command, replyToMessageId: messageId };
  for (const candidate of [
    null,
    { ...reply, channelId: 'f'.repeat(24) },
    { ...reply, text: null, removedAt: resources.now },
  ])
    await assertRejects({
      given: 'a missing, foreign-channel or deleted reply target',
      should: 'refuse a reply',
      actual: () =>
        planMessageSend(replying, { ...context, reply: candidate }, resources),
      code: 'NOT_FOUND',
    });
  await assertRejects({
    given: 'a change counter at the safe integer bound',
    should: 'refuse overflow',
    actual: () =>
      planMessageSend(
        command,
        {
          ...context,
          counters: { ...counters, changeVersion: Number.MAX_SAFE_INTEGER },
        },
        resources,
      ),
    code: 'CONFLICT',
  });
});
