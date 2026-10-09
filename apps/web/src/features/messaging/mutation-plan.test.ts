import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { planMessageMutation } from './mutation-plan';
import type { MessagingMessageRecord } from '@daisy/db/messaging';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  channelId = 'c'.repeat(24),
  messageId = 'm'.repeat(24);
const message: MessagingMessageRecord = {
  id: messageId,
  channelId,
  authorActorId: actorId,
  sequence: 1,
  changeVersion: 1,
  text: 'Original',
  createdAt: '2026-10-09T18:00:00.000Z',
  editedAt: null,
  removedAt: null,
};
test('message mutations preserve immutable sequence and respect injected author edit deadline', async () => {
  const resources = {
    actorId,
    now: '2026-10-09T18:14:59.999Z',
    editWindowMs: 900000,
    changeVersion: 3,
  };
  const edit = planMessageMutation(
    { kind: 'edit', channelId, messageId, text: 'Edited' },
    message,
    resources,
  );
  assert({
    given: 'the author just before the injected edit deadline',
    should: 'replace current text under a new independent version',
    actual: {
      sequence: edit.message.sequence,
      version: edit.message.changeVersion,
      text: edit.message.text,
    },
    expected: { sequence: 1, version: 4, text: 'Edited' },
  });
  for (const patch of [
    { actorId: 'b'.repeat(24) },
    { now: '2026-10-09T18:15:00.000Z' },
  ])
    await assertRejects({
      given: JSON.stringify(patch),
      should: 'refuse nonauthor or deadline edit without changing source',
      actual: () =>
        planMessageMutation(
          { kind: 'edit', channelId, messageId, text: 'Forbidden' },
          message,
          { ...resources, ...patch },
        ),
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'refused edits',
    should: 'keep original content untouched',
    actual: message.text,
    expected: 'Original',
  });
});
test('own removal discards text with a minimal unavailable result and refuses foreign references', async () => {
  const resources = {
    actorId,
    now: '2026-10-10T18:00:00.000Z',
    editWindowMs: 1,
    changeVersion: 5,
  };
  const removed = planMessageMutation(
    { kind: 'remove', channelId, messageId },
    message,
    resources,
  );
  assert({
    given: 'the author outside the edit deadline',
    should: 'remove own text without reallocating creation sequence',
    actual: {
      text: removed.message.text,
      removedAt: removed.message.removedAt,
      sequence: removed.message.sequence,
      version: removed.message.changeVersion,
    },
    expected: { text: null, removedAt: resources.now, sequence: 1, version: 6 },
  });
  await assertRejects({
    given: 'a message from another channel',
    should: 'refuse without leaking its body',
    actual: () =>
      planMessageMutation(
        { kind: 'remove', channelId: 'd'.repeat(24), messageId },
        message,
        resources,
      ),
    code: 'NOT_FOUND',
  });
});
