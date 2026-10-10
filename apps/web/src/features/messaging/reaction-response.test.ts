import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readReactionResponse } from './reaction-response';
setupRitewayBun();
test('native reaction summary refuses foreign scope, actor lists, malformed policy and unavailable responses', async () => {
  const channelId = 'c'.repeat(24),
    messageId = 'm'.repeat(24);
  const body = {
    version: 1,
    channelId,
    messageId,
    changeVersion: 9,
    replayed: false,
    reactions: [{ reaction: '👍', count: 2, own: true }],
    policy: { reactionUnits: 8, choices: ['👍'] },
  };
  const accepted = await readReactionResponse(
    Response.json(body),
    channelId,
    messageId,
  );
  const refusals = await Promise.all(
    [
      { ...body, channelId: 'x'.repeat(24) },
      {
        ...body,
        reactions: [{ ...body.reactions[0], actors: ['a'.repeat(24)] }],
      },
      { ...body, policy: { ...body.policy, choices: ['👍', '👍'] } },
      { ...body, messageId: 'z'.repeat(24) },
    ].map((value) =>
      readReactionResponse(Response.json(value), channelId, messageId),
    ),
  );
  refusals.push(
    await readReactionResponse(
      new Response(null, { status: 503 }),
      channelId,
      messageId,
    ),
  );
  assert({
    given: 'the current own-channel count/own projection and invalid envelopes',
    should:
      'render only validated scoped summaries and explicit choices without participant identities',
    actual: [accepted?.result.reactions, accepted?.policy, refusals],
    expected: [body.reactions, body.policy, [null, null, null, null, null]],
  });
});
