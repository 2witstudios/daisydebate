import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { noopErrorReporter } from '@daisy/observability';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../server/test-loggers.test-support';
import { member, origin } from '../../server/member-boundary.test-support';
import { CommandDenied } from './commands/run-command';
import { createTabCommandRoute } from './command-route';
setupRitewayBun();
const response = (
  options: {
    readonly released?: boolean;
    readonly identity?: Identity;
    readonly crossOrigin?: boolean;
    readonly invalidBody?: boolean;
    readonly denied?: boolean;
    readonly invalid?: boolean;
    readonly lobbyId?: string;
  } = {},
) => {
  const asked: unknown[] = [];
  const route = createTabCommandRoute({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => options.identity ?? member,
    },
    name: 'tab.entries.command',
    address: 'lobby',
    released: async () => options.released ?? true,
    execute: async (principal, lobbyId, body) => {
      asked.push([principal.userId, lobbyId, body]);
      if (options.denied) throw new CommandDenied('private reason');
      if (options.invalid) throw createAppError('VALIDATION');
      return { kind: 'refused', refusal: 'already-entered' };
    },
  });
  const request = new Request(
    `${origin}/api/tab/entries-command?lobbyId=${options.lobbyId ?? 'l'.repeat(24)}`,
    {
      method: 'POST',
      headers: {
        origin: options.crossOrigin ? 'https://other.example' : origin,
        'content-type': 'application/json',
      },
      body: options.invalidBody
        ? '{'
        : JSON.stringify({ commandId: 'command', userId: 'spoofed' }),
    },
  );
  return { answer: route(request), asked };
};
test('a command uses the resolved session principal and addressed lobby, retaining its domain refusal', async () => {
  const { answer, asked } = response();
  const result = await answer;
  assert({
    given: 'a signed-in caller supplying a conflicting user id in the payload',
    should:
      'pass the actual identity and lobby to the operation and prevent caching',
    actual: [
      result.status,
      await result.json(),
      result.headers.get('cache-control'),
      asked,
    ],
    expected: [
      200,
      { kind: 'refused', refusal: 'already-entered' },
      'no-store',
      [
        [
          member.principal.userId,
          'l'.repeat(24),
          { commandId: 'command', userId: 'spoofed' },
        ],
      ],
    ],
  });
});
test('a restricted withdrawal reaches the evaluator while a closed release and cross-origin request do not', async () => {
  const restricted = response({ identity: { ...member, state: 'restricted' } });
  const closed = response({ released: false, invalidBody: true });
  const foreign = response({ crossOrigin: true });
  const statuses = await Promise.all(
    [restricted, closed, foreign].map(
      async ({ answer }) => (await answer).status,
    ),
  );
  assert({
    given:
      'a restricted member, a closed feature with malformed body and a foreign origin',
    should: 'allow only the evaluated request to reach the operation',
    actual: [
      statuses,
      [restricted.asked.length, closed.asked.length, foreign.asked.length],
    ],
    expected: [
      [200, 404, 403],
      [1, 0, 0],
    ],
  });
});
test('transport validation and domain denials preserve public error categories', async () => {
  const cases = [
    response({ invalidBody: true }),
    response({ lobbyId: 'invalid' }),
    response({ denied: true }),
    response({ invalid: true }),
  ];
  assert({
    given:
      'malformed JSON, an invalid target, a domain denial and invalid domain input',
    should:
      'return validation or not-found rather than leak a denial or report a server fault',
    actual: await Promise.all(
      cases.map(async ({ answer }) => (await answer).status),
    ),
    expected: [400, 400, 404, 400],
  });
});
