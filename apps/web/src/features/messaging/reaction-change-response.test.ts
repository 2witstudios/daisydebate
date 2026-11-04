import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readReactionChangeResponse } from './reaction-change-response';

setupRitewayBun();
const channelId = 'c'.repeat(24);
const messageId = 'm'.repeat(24);
const body = {
  version: 1,
  channelId,
  messageId,
  changeVersion: 7,
  replayed: false,
  reactions: [{ reaction: '👍', count: 2, own: true }],
};

test('a reaction answer supplies authoritative counts without another history read', async () => {
  const result = await readReactionChangeResponse(Response.json(body), {
    channelId,
    messageId,
  });
  assert({
    given: 'an accepted toggle with a concurrent reaction from another member',
    should: 'use the accepted total and viewer ownership',
    actual: result?.reactions,
    expected: body.reactions,
  });
});

test('an unrelated or refused reaction answer cannot change a pill', async () => {
  const results = await Promise.all(
    [
      Response.json({ ...body, messageId: 'x'.repeat(24) }),
      Response.json({ ...body, channelId: 'x'.repeat(24) }),
      Response.json({
        ...body,
        reactions: [{ reaction: '👍', count: -1, own: true }],
      }),
      new Response(null, { status: 403 }),
    ].map((response) =>
      readReactionChangeResponse(response, { channelId, messageId }),
    ),
  );
  assert({
    given: 'a different scope, malformed count or denied toggle',
    should: 'refuse every answer',
    actual: results,
    expected: [null, null, null, null],
  });
});
