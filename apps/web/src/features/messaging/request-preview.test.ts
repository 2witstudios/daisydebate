import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readRequestPreviewResponse } from './request-preview';
setupRitewayBun();
test('request preview transport refuses missing bounds and does not consume refused content', async () => {
  const refused = Response.json(
    { introduction: 'Hidden introduction' },
    { status: 404 },
  );
  assert({
    given: 'a protected preview refusal',
    should: 'return unavailable without consuming private body data',
    actual: [await readRequestPreviewResponse(refused), refused.bodyUsed],
    expected: [null, false],
  });
  const data = {
    version: 1,
    channelId: 'channel'.padEnd(24, 'x'),
    senderActorId: 'sender'.padEnd(24, 'x'),
    introduction: 'Private introduction',
    requestedAt: '2026-10-09T18:00:00.000Z',
  };
  await assertRejects({
    given: 'a successful response with no configured bounds',
    should: 'refuse without guessing a client contract',
    actual: () => readRequestPreviewResponse(Response.json(data)),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'a validated response with actual configured social bounds',
    should: 'preserve only the portable request view',
    actual: await readRequestPreviewResponse(
      Response.json(data, {
        headers: {
          'x-messaging-introduction-units': '100',
          'x-messaging-title-units': '80',
          'x-messaging-batch-actors': '10',
        },
      }),
    ),
    expected: data,
  });
});
