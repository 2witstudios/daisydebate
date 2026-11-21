import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runTabCommandForm } from './command-form-action';

setupRitewayBun();

const action = (post: (request: Request) => Promise<Response>) => ({
  post,
  path: '/api/tab/entries-command?lobbyId=lobby',
  incoming: new Headers({
    cookie: 'session=test',
    origin: 'https://daisy.example',
    'content-type': 'multipart/form-data',
    'content-length': '900',
  }),
  body: { version: 1 },
  answer: (body: unknown) => ({ body }),
  refused: (status: number) => ({ status }),
  unacknowledged: () => 'unacknowledged',
});

test('send the JSON command through its mounted handler', async () => {
  const result = await runTabCommandForm<unknown>(
    action(async (request) => {
      return Response.json({
        method: request.method,
        url: new URL(request.url).search,
        cookie: request.headers.get('cookie'),
        origin: request.headers.get('origin'),
        contentType: request.headers.get('content-type'),
        length: request.headers.get('content-length'),
        command: await request.json(),
      });
    }),
  );
  assert({
    given: 'a form submit scoped to the signed-in browser and a lobby',
    should:
      'send the same session and origin with a fresh JSON body to the designated route',
    actual: result,
    expected: {
      body: {
        method: 'POST',
        url: '?lobbyId=lobby',
        cookie: 'session=test',
        origin: 'https://daisy.example',
        contentType: 'application/json',
        length: null,
        command: { version: 1 },
      },
    },
  });
});

test('preserve refusals and unacknowledged transport outcomes', async () => {
  const result = await Promise.all(
    [
      new Response(null, { status: 400 }),
      new Response(null, { status: 403 }),
      new Response(null, { status: 503 }),
      new Response('invalid JSON'),
      Response.json({ kind: 'refused', refusal: 'version-conflict' }),
    ].map((response) =>
      runTabCommandForm<unknown>(action(async () => response)),
    ),
  );
  assert({
    given:
      'validation, permission, infrastructure, malformed and domain replies',
    should:
      'keep the client error status and hand successful bodies to the form mapper',
    actual: result,
    expected: [
      { status: 400 },
      { status: 403 },
      'unacknowledged',
      'unacknowledged',
      { body: { kind: 'refused', refusal: 'version-conflict' } },
    ],
  });
});

test('propagate command transport failures to the tournament creation flow', async () => {
  const error = new Error('request failed');
  const post = async () => {
    throw error;
  };
  const result = await runTabCommandForm<unknown>({
    ...action(post),
    transportFailure: 'throw',
  }).catch((failure: unknown) => failure);
  assert({
    given: 'a command transport failure during tournament creation',
    should: 'let the creation operation classify the failed step',
    actual: result,
    expected: error,
  });
});
