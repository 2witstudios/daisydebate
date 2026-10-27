import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { messagingBetaLimits } from '@daisy/protocol';
import { readJson } from '../../server/http';
import { parseMessagingPolicyLimits } from './beta-limits';
setupRitewayBun();

const within = {
  bounds: { messageUnits: 4000, pageItems: 100 },
  maxBodyBytes: 65536,
  social: {
    bounds: { introductionUnits: 500, titleUnits: 80, batchActors: 50 },
  },
};

test('a messaging policy is accepted only within the DEC-124 beta limits', async () => {
  assert({
    given: 'a policy exactly at every beta limit',
    should: 'return it unchanged',
    actual: parseMessagingPolicyLimits(within),
    expected: within,
  });
  assert({
    given: 'a policy without social routes',
    should: 'check only its core bounds and body size',
    actual: parseMessagingPolicyLimits({ ...within, social: undefined }),
    expected: { ...within, social: undefined },
  });
  for (const [given, policy] of [
    [
      'a JSON body above 64 KiB',
      { ...within, maxBodyBytes: messagingBetaLimits.bodyBytes + 1 },
    ],
    [
      'a message limit above 4,000 units',
      { ...within, bounds: { ...within.bounds, messageUnits: 4001 } },
    ],
    [
      'a group title limit above 80 units',
      {
        ...within,
        social: { bounds: { ...within.social.bounds, titleUnits: 81 } },
      },
    ],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse the policy before any route composes',
      actual: async () => parseMessagingPolicyLimits(policy),
      code: 'VALIDATION',
    });
});

test('the 64 KiB body fits a limit-sized message at worst-case JSON escaping', () => {
  const worst = {
    version: 1,
    channelId: 'c'.repeat(24),
    requestId: 'r'.repeat(24),
    replyToMessageId: 'm'.repeat(24),
    text: '\u0001'.repeat(messagingBetaLimits.messageUnits),
  };
  assert({
    given: 'a 4,000-unit message of characters JSON escapes to six bytes',
    should: 'still fit the beta body limit with its envelope',
    actual:
      new TextEncoder().encode(JSON.stringify(worst)).byteLength <=
      messagingBetaLimits.bodyBytes,
    expected: true,
  });
});

test('a chunked body is bounded at exactly 64 KiB without Content-Length', async () => {
  const streamed = (bytes: number) => {
    const body = new TextEncoder().encode(
      JSON.stringify({ text: 'x'.repeat(bytes - 11) }),
    );
    return new Request('https://daisy.example/api/messaging/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          for (let at = 0; at < body.byteLength; at += 4096)
            controller.enqueue(body.slice(at, at + 4096));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
  };
  const limit = messagingBetaLimits.bodyBytes;
  assert({
    given: 'a chunked body of exactly the beta limit',
    should: 'be read in full',
    actual: ((await readJson(streamed(limit), limit)) as { text: string }).text
      .length,
    expected: limit - 11,
  });
  await assertRejects({
    given: 'a chunked body one byte over the beta limit',
    should: 'be refused as too large',
    actual: () => readJson(streamed(limit + 1), limit),
    code: 'PAYLOAD_TOO_LARGE',
  });
});
