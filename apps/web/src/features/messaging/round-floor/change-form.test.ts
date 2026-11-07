import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitFloorChange } from './change-form';
setupRitewayBun();
const scope = { roundId: 'r'.repeat(24), channelId: 'c'.repeat(24) };
const requestId = 'q'.repeat(24),
  messageId = 'm'.repeat(24);
const form = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ kind: 'remove', messageId, requestId }))
    f.set(k, v);
  return f;
};
test('unknown change cannot become another command', async () => {
  const lost = await submitFloorChange(
    async () => {
      throw Error('lost');
    },
    scope,
    { text: '', requestId },
    form(),
    () => 'n'.repeat(24),
  );
  const altered = form();
  altered.set('messageId', 'x'.repeat(24));
  let calls = 0;
  const retry = await submitFloorChange(
    async () => {
      calls++;
      return Response.json({});
    },
    scope,
    lost,
    altered,
    () => 'n'.repeat(24),
  );
  assert({
    given: 'a lost removal answer then a different target',
    should: 'preserve the original command without sending the alteration',
    actual: [calls, retry.command, retry.uncertain],
    expected: [0, lost.command, true],
  });
});
test('foreign acknowledgement keeps the change uncertain', async () => {
  const result = await submitFloorChange(
    async () =>
      Response.json({ id: 'x'.repeat(24), channelId: scope.channelId }),
    scope,
    { text: '', requestId },
    form(),
    () => 'n'.repeat(24),
  );
  assert({
    given: 'a success body for another message',
    should: 'retain the request for retry',
    actual: [result.requestId, result.uncertain, result.sent],
    expected: [requestId, true, undefined],
  });
});
test('a bound canonical tombstone confirms removal', async () => {
  const result = await submitFloorChange(
    async () =>
      Response.json({
        id: messageId,
        channelId: scope.channelId,
        sequence: 1,
        changeVersion: 2,
        unavailable: true,
      }),
    scope,
    { text: '', requestId },
    form(),
    () => 'n'.repeat(24),
  );
  assert({
    given: 'the canonical own-removal reply',
    should:
      'settle the command instead of locking a successful removal as uncertain',
    actual: result,
    expected: { text: '', requestId: 'n'.repeat(24), sent: messageId },
  });
});
test('a confirmed edit preserves the current text for another edit', async () => {
  const edit = form();
  edit.set('kind', 'edit');
  edit.set('text', 'Revised');
  const result = await submitFloorChange(
    async () =>
      Response.json({
        id: messageId,
        channelId: scope.channelId,
        authorActorId: 'a'.repeat(24),
        sequence: 1,
        changeVersion: 2,
        text: 'Revised',
        createdAt: '2026-11-06T00:00:00.000Z',
        editedAt: '2026-11-06T00:00:01.000Z',
      }),
    scope,
    { text: 'Old', requestId },
    edit,
    () => 'n'.repeat(24),
  );
  assert({
    given: 'a confirmed author edit',
    should: 'keep acknowledged text as the next editable draft',
    actual: result.text,
    expected: 'Revised',
  });
});
