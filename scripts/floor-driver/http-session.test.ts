import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createHttpSession } from './http-session';

setupRitewayBun();

const serving = (statuses: number[]) => {
  const seen: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      seen.push(await request.text());
      return Response.json({}, { status: statuses.shift() ?? 200 });
    },
  });
  return { server, seen };
};

test('a refused request retries as a browser does, and every refusal is counted', async () => {
  const { server, seen } = serving([503, 503, 200]);
  const refused: string[] = [];
  const session = createHttpSession({
    origin: `http://127.0.0.1:${server.port}`,
    refused: (operation, status) => refused.push(`${operation} ${status}`),
    retryDelaysMs: [0, 0, 0],
  });
  const answer = await session.request('round.view', '/x', { json: { a: 1 } });
  await server.stop();
  assert({
    given: 'two 503s, then an answer',
    should: 'send the same request again and report each refusal',
    actual: [answer.status, seen, refused],
    expected: [
      200,
      ['{"a":1}', '{"a":1}', '{"a":1}'],
      ['round.view 503', 'round.view 503'],
    ],
  });
});

test('a session stops retrying once its delays run out', async () => {
  const { server } = serving([503, 503, 503]);
  const session = createHttpSession({
    origin: `http://127.0.0.1:${server.port}`,
    refused: () => undefined,
    retryDelaysMs: [0],
  });
  const answer = await session.request('round.view', '/x');
  await server.stop();
  assert({
    given: 'more refusals than delays',
    should: 'return the refusal for the caller to judge',
    actual: answer.status,
    expected: 503,
  });
});
