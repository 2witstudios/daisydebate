import { assert, setupRitewayBun, test } from 'riteway/bun';
import { submitFloorChange } from './change-form';
import { floorIdle, floorUnacknowledged } from './form-state';
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
    floorIdle(requestId),
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
    actual: [calls, lost, retry],
    expected: [
      0,
      floorUnacknowledged(
        { kind: 'remove', messageId, requestId },
        'Message could not be sent. Your draft is kept; try again.',
      ),
      floorUnacknowledged(
        { kind: 'remove', messageId, requestId },
        'Retry the original change before starting another one.',
      ),
    ],
  });
});
test('foreign acknowledgement keeps the change uncertain', async () => {
  const result = await submitFloorChange(
    async () =>
      Response.json({ id: 'x'.repeat(24), channelId: scope.channelId }),
    scope,
    floorIdle(requestId),
    form(),
    () => 'n'.repeat(24),
  );
  assert({
    given: 'a success body for another message',
    should: 'retain the request for retry',
    actual: result,
    expected: floorUnacknowledged(
      { kind: 'remove', messageId, requestId },
      'Message could not be sent. Your draft is kept; try again.',
    ),
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
    floorIdle(requestId),
    form(),
    () => 'n'.repeat(24),
  );
  assert({
    given: 'the canonical own-removal reply',
    should:
      'settle the command instead of locking a successful removal as uncertain',
    actual: result,
    expected: {
      kind: 'changed',
      messageId,
      requestId: 'n'.repeat(24),
      text: '',
      changeVersion: 2,
    },
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
    floorIdle(requestId, 'Old'),
    edit,
    () => 'n'.repeat(24),
  );
  assert({
    given: 'a confirmed author edit',
    should: 'keep acknowledged text as the next editable draft',
    actual: result,
    expected: {
      kind: 'changed',
      messageId,
      requestId: 'n'.repeat(24),
      text: 'Revised',
      changeVersion: 2,
    },
  });
});
test('an exact edit retry acknowledges the newer current message', async () => {
  const edit = form();
  edit.set('kind', 'edit');
  edit.set('text', 'First saved edit');
  const result = await submitFloorChange(
    async () =>
      Response.json({
        id: messageId,
        channelId: scope.channelId,
        authorActorId: 'a'.repeat(24),
        sequence: 1,
        changeVersion: 3,
        text: 'Later edit from another device',
        createdAt: '2026-11-06T00:00:00.000Z',
        editedAt: '2026-11-06T00:00:02.000Z',
      }),
    scope,
    floorUnacknowledged(
      { kind: 'edit', messageId, requestId, text: 'First saved edit' },
      'Message could not be sent. Your draft is kept; try again.',
    ),
    edit,
    () => 'n'.repeat(24),
  );
  assert({
    given: 'the canonical current-state reply after a digest-validated replay',
    should: 'settle uncertainty with current text and revision',
    actual: result,
    expected: {
      kind: 'changed',
      messageId,
      requestId: 'n'.repeat(24),
      text: 'Later edit from another device',
      changeVersion: 3,
    },
  });
});

test('a floor change answers exactly one kind', async () => {
  const answered = (
    status: number,
    earlier: unknown = floorIdle(requestId),
    posted = form(),
    report = false,
  ) =>
    submitFloorChange(
      async () =>
        status === 200
          ? Response.json({ received: true })
          : new Response(null, { status }),
      scope,
      earlier,
      posted,
      () => 'n'.repeat(24),
      report,
    );
  const lost = floorUnacknowledged(
    { kind: 'remove', messageId, requestId },
    'Message could not be sent. Your draft is kept; try again.',
  );
  const invalid = form();
  invalid.set('kind', 'promote');
  const reported = new FormData();
  reported.set('messageId', messageId);
  reported.set('requestId', requestId);
  reported.set('reason', 'spam');
  assert({
    given:
      'a refusal, a server failure, a refused retry, an unknown operation, its retry, and a report',
    should:
      'refuse what the server turned down, hold what may have committed, and never lose an unacknowledged command',
    actual: [
      await answered(403),
      (await answered(500)).kind,
      await answered(429, lost),
      (await answered(200, floorIdle(requestId), invalid)).kind,
      await answered(403, lost, invalid),
      await answered(200, floorIdle(requestId), reported, true),
    ],
    expected: [
      {
        kind: 'refused',
        values: { text: '', requestId },
        error: 'This change was not accepted. Your text is kept.',
      },
      'unacknowledged',
      floorUnacknowledged(lost.values, 'Please wait before trying again.'),
      'refused',
      floorUnacknowledged(
        lost.values,
        'Retry the original change before starting another one.',
      ),
      { kind: 'sent', messageId, requestId: 'n'.repeat(24) },
    ],
  });
});
