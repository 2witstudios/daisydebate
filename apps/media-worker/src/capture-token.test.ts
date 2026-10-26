import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { captureFailureExit, describeCaptureExit } from './capture-exit';
import { issueCaptureToken } from './capture-token';
setupRitewayBun();

const scope = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
};
const tokenReply = {
  sessionId: scope.sessionId,
  roomName: 'm'.repeat(24),
  identity: 'i'.repeat(24),
  url: 'wss://media.invalid',
  token: 'token',
  expiresAt: new Date(60_000).toISOString(),
};
const reply = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status });
/** The server's token answers in order; `slow` outlasts the call's deadline. */
type Answer = 'slow' | 'ok' | 'refused';

/**
 * A worker client whose token answers follow `answers` and whose lease
 * renewals report `epochs` in turn, recording each operation it serves.
 */
function server(answers: readonly Answer[], epochs: readonly number[] = [1]) {
  const calls: string[] = [];
  let tokens = 0,
    leases = 0;
  const client = createMediaWorkerClient({
    scope,
    url: 'http://127.0.0.1/',
    authentication: createMediaWorkerAuthentication({
      secret: Buffer.alloc(32, 6).toString('base64url'),
      now: () => 1000,
    }),
    fetch: async (url, init) => {
      const operation = url.split('/').at(-1)!;
      calls.push(operation);
      if (operation === 'lease')
        return reply({
          epoch: epochs[Math.min(leases++, epochs.length - 1)],
          expiresAt: new Date(15_000).toISOString(),
        });
      const answer = answers[tokens++];
      if (answer === 'ok') return reply(tokenReply);
      if (answer === 'refused') return reply({}, 403);
      // The claim queue holds the request past the deadline, which aborts it.
      return new Promise<Response>((_, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    },
    nowMs: performance.now,
    deadlineSignal: () => AbortSignal.timeout(20),
  });
  const issue = () =>
    issueCaptureToken(client, 1, new AbortController().signal).then(
      (token) => token.token,
      (error: unknown) => describeCaptureExit(captureFailureExit(error)),
    );
  return { calls, issue };
}

test('a capture token that outlasts its deadline is asked for again under a renewed lease', async () => {
  const once = server(['slow', 'ok']);
  assert({
    given:
      'a token request queued past the call deadline, then one answered in time (ISSUE-571)',
    should: 'renew the lease and return the second token',
    actual: { token: await once.issue(), calls: once.calls },
    expected: { token: 'token', calls: ['token', 'lease', 'token'] },
  });
  const always = server(['slow', 'slow', 'slow', 'ok']);
  assert({
    given: 'every one of the three attempts outlasting its deadline',
    should: 'stop at the token stage, as an uncertain failure',
    actual: { exit: await always.issue(), calls: always.calls.length },
    expected: {
      exit: { cause: 'token', errorCode: 'INFRASTRUCTURE' },
      calls: 5,
    },
  });
});

test('a capture token the server definitely refused is never asked for again', async () => {
  const refused = server(['refused', 'ok']);
  assert({
    given: 'a definite refusal of the token',
    should: 'report the token stage at once, without a retry',
    actual: { exit: await refused.issue(), calls: refused.calls },
    expected: {
      exit: { cause: 'token', errorCode: 'AUTHORIZATION' },
      calls: ['token'],
    },
  });
  const taken = server(['slow', 'ok'], [2]);
  assert({
    given: 'a renewal between attempts that finds another epoch',
    should: 'report the renewal conflict instead of asking again',
    actual: { exit: await taken.issue(), calls: taken.calls },
    expected: {
      exit: { cause: 'renewal', errorCode: 'CONFLICT' },
      calls: ['token', 'lease'],
    },
  });
});
