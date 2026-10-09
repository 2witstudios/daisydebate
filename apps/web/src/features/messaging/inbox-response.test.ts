import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readMessagingInboxResponse } from './inbox-response';
setupRitewayBun();
test('inbox transport requires explicit bounds and refuses private or unbounded entries', async () => {
  const result = {
    version: 1 as const,
    entries: [{ channelId: 'c'.repeat(24), kind: 'incoming_request' as const }],
    nextAfter: null,
  };
  const read = (body: unknown) =>
    readMessagingInboxResponse(
      Response.json(body, { headers: { 'x-messaging-page-items': '1' } }),
    );
  assert({
    given: 'a bounded own request navigation response',
    should: 'preserve its validated minimal projection',
    actual: await read(result),
    expected: { ...result, socketUrl: null },
  });
  for (const body of [
    { ...result, entries: [...result.entries, ...result.entries] },
    { ...result, entries: [{ ...result.entries[0], introduction: 'private' }] },
  ])
    await assertRejects({
      given: 'an oversized page or undeclared content',
      should: 'refuse the transport response',
      code: 'INFRASTRUCTURE',
      actual: () => read(body),
    });
  await assertRejects({
    given: 'a missing policy page bound',
    should: 'refuse rather than guess a default',
    code: 'INFRASTRUCTURE',
    actual: () => readMessagingInboxResponse(Response.json(result)),
  });
});
