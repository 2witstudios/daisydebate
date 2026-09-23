import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import {
  revokeOthersOnVerifyEmailPlugin,
  SESSION_CLEANUP_FAILED_HEADER,
} from './revoke-others-on-verify-email';

setupRitewayBun();

type Logged = { event: string; fields: Record<string, unknown> };
const recorder = () => {
  const logged: Logged[] = [];
  const logger: Logger = {
    log: (event, fields) => void logged.push({ event, fields }),
    child: () => logger,
  };
  return { logged, logger };
};

const context = (
  path: string,
  newSession: { session: { token: string }; user: { id: string } } | null,
  responseHeaders: Headers | undefined = new Headers(),
) => ({
  path,
  context: { newSession, responseHeaders },
});

const runAfterHook = async (
  revokeOtherSessions: (userId: string, keepToken: string) => Promise<number>,
  logger: Logger,
  path: string,
  newSession: Parameters<typeof context>[1],
  responseHeaders?: Headers,
) => {
  const plugin = revokeOthersOnVerifyEmailPlugin(revokeOtherSessions, logger);
  const hook = plugin.hooks?.after?.[0];
  if (!hook) throw new Error('plugin defines no after hook');
  const ctx = context(path, newSession, responseHeaders);
  if (!hook.matcher(ctx as never)) return 'not-matched';
  await hook.handler(ctx as never);
  return ctx.context.responseHeaders;
};

describe('revokeOthersOnVerifyEmailPlugin matcher', () => {
  test('matches only /verify-email', () => {
    const { logger } = recorder();
    const plugin = revokeOthersOnVerifyEmailPlugin(async () => 0, logger);
    const hook = plugin.hooks?.after?.[0];
    if (!hook) throw new Error('plugin defines no after hook');
    const paths = ['/verify-email', '/magic-link/verify', '/change-email'];
    assert({
      given: '/verify-email and two unrelated paths',
      should: 'match only /verify-email',
      actual: paths.map((path) => hook.matcher(context(path, null) as never)),
      expected: [true, false, false],
    });
  });
});

describe('revokeOthersOnVerifyEmailPlugin handler', () => {
  test('revokes every other session for the new session owner, keeping its own token', async () => {
    const calls: Array<[string, string]> = [];
    const { logger } = recorder();
    await runAfterHook(
      async (userId, keepToken) => {
        calls.push([userId, keepToken]);
        return 1;
      },
      logger,
      '/verify-email',
      { session: { token: 'new-token' }, user: { id: 'user-1' } },
    );
    assert({
      given: 'an after hook whose context carries a new session',
      should: 'revoke every other session for that user, keeping its token',
      actual: calls,
      expected: [['user-1', 'new-token']],
    });
  });

  test('does nothing when no new session was set on the context', async () => {
    let called = false;
    const { logger } = recorder();
    await runAfterHook(
      async () => {
        called = true;
        return 0;
      },
      logger,
      '/verify-email',
      null,
    );
    assert({
      given: 'the old-address approval hop, which sets no session cookie',
      should: 'never call revokeOtherSessions',
      actual: called,
      expected: false,
    });
  });

  test('a failing revoke is swallowed, logged, and flagged on the response header', async () => {
    const { logged, logger } = recorder();
    let outcome: 'threw' | 'resolved' = 'resolved';
    let headers: Headers | 'not-matched' | undefined;
    try {
      headers = await runAfterHook(
        async () => {
          throw new Error('db unavailable: password=hunter2');
        },
        logger,
        '/verify-email',
        { session: { token: 'new-token' }, user: { id: 'user-1' } },
      );
    } catch {
      outcome = 'threw';
    }
    assert({
      given: 'a revokeOtherSessions that rejects with a sensitive message',
      should:
        'resolve the hook anyway, flag the response header, and log the registered event with no error detail',
      actual: {
        outcome,
        headerSet:
          headers instanceof Headers
            ? headers.get(SESSION_CLEANUP_FAILED_HEADER)
            : headers,
        logged: logged.map(({ event, fields }) => [event, fields]),
        leaked: JSON.stringify(logged).includes('hunter2'),
      },
      expected: {
        outcome: 'resolved',
        headerSet: 'true',
        logged: [
          [
            'auth.email_change.cleanup_failed',
            { operation: 'auth.verify_email' },
          ],
        ],
        leaked: false,
      },
    });
  });
});
