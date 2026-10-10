import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRouteBinder } from './route-binding';
import { messagingChannelRead } from './messaging-channel-binding';
setupRitewayBun();
test('channel metadata routes resolve only trusted async path scope through the injected binder', async () => {
  const path = 'c'.repeat(24),
    calls: unknown[] = [];
  const binder = createRouteBinder(() => ({
    messaging: {
      typing: async (request: Request, write: boolean, channelId?: string) => {
        calls.push(['typing', request.url, write, channelId]);
        return Response.json({ typing: false });
      },
      preferences: async (
        request: Request,
        operation: 'read' | 'update' | 'clear',
        channelId?: string,
      ) => {
        calls.push(['preferences', request.url, operation, channelId]);
        return Response.json({ state: null });
      },
    },
  }));
  const request = new Request(
      'https://daisy.example/metadata?channelId=untrusted',
    ),
    responses = [];
  for (const operation of ['typing', 'preferences'] as const)
    responses.push(
      await (
        await messagingChannelRead(binder, operation)(request, {
          params: Promise.resolve({ channelId: path }),
        })
      ).json(),
    );
  assert({
    given: 'two channel read routes and hostile query scope',
    should:
      'pass only the resolved path id and fixed read dispatch while preserving each response',
    actual: [calls, responses],
    expected: [
      [
        ['typing', request.url, false, path],
        ['preferences', request.url, 'read', path],
      ],
      [{ typing: false }, { state: null }],
    ],
  });
});
