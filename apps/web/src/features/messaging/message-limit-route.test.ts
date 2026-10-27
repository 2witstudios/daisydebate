import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { silentLogger } from '../../server/test-loggers.test-support';
import { betaMessagingPolicy } from './beta-policy';
import { createMessagingHandlers } from './handlers';
import { sendMessagingMessage } from './send';

setupRitewayBun();

const refuse = async () => {
  throw new Error('Not under test');
};

/**
 * The deployed send path: the beta policy's body and text bounds, the real
 * HTTP adapter and operation, and a store whose authorization refuses, so
 * a request that passes validation answers 403 and one that fails it 400.
 */
const deployedSend = () => {
  const reached: string[] = [];
  const handlers = createMessagingHandlers({
    logger: silentLogger,
    origin: () => 'https://daisy.example',
    maxBodyBytes: betaMessagingPolicy.maxBodyBytes,
    bounds: betaMessagingPolicy.bounds,
    identify: async () => ({
      state: 'member',
      username: 'ada',
      principal: {
        kind: 'user',
        userId: 'u'.repeat(24),
        actorId: 'a'.repeat(24),
      },
    }),
    send: (input, principal) =>
      sendMessagingMessage(input, principal, {
        bounds: betaMessagingPolicy.bounds,
        store: {
          withChannel: async (_scope, work) =>
            work({
              authorize: async () => {
                reached.push('authorize');
                throw createAppError('AUTHORIZATION');
              },
              readSendState: refuse,
              commitSend: refuse,
            }),
        },
        ids: { next: () => 'm'.repeat(24) },
        clock: { now: () => '2026-10-27T12:00:00.000Z' },
        limit: async () => {},
      }),
    edit: refuse,
    remove: refuse,
    search: refuse,
    history: refuse,
    changes: refuse,
    markRead: refuse,
  });
  const send = async (text: string) => {
    const response = await handlers.send(
      new Request('https://daisy.example/api/messaging/messages', {
        method: 'POST',
        headers: {
          origin: 'https://daisy.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 1,
          channelId: 'c'.repeat(24),
          requestId: 'r'.repeat(24),
          text,
        }),
      }),
    );
    return response.status;
  };
  return { send, reached };
};

test('the deployed send route takes exactly 4,000 UTF-16 units and refuses one more (ISSUE-642)', async () => {
  const { send, reached } = deployedSend();
  // A supplementary character is two units, and a quote escapes to two bytes.
  const atLimit = '😀' + '"'.repeat(1_000) + 'a'.repeat(2_998);
  assert({
    given:
      'texts of 4,000 units (with a surrogate pair and escaped quotes), 4,001 units, one supplementary character over, and only whitespace',
    should:
      'pass validation at the limit and refuse the rest as invalid before authority',
    actual: [
      atLimit.length,
      await send(atLimit),
      await send(atLimit + 'a'),
      await send('😀'.repeat(2_000) + '😀'),
      await send(' \n\t '),
      reached,
    ],
    expected: [4_000, 403, 400, 400, 400, ['authorize']],
  });
});
