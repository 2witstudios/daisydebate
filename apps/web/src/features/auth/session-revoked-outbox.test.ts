import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { APIError } from 'better-auth/api';
import { sessionRevokedOutboxPlugin } from './session-revoked-outbox';

setupRitewayBun();

const context = (path: string, returned: unknown, userId?: string) => ({
  path,
  context: {
    returned,
    session: userId ? { user: { id: userId } } : undefined,
  },
});

const runAfterHook = async (
  appendSessionRevoked: (userId: string) => Promise<void>,
  path: string,
  returned: unknown,
  userId?: string,
) => {
  const plugin = sessionRevokedOutboxPlugin(appendSessionRevoked);
  const hook = plugin.hooks?.after?.[0];
  if (!hook) throw new Error('plugin defines no after hook');
  const ctx = context(path, returned, userId);
  if (!hook.matcher(ctx as never)) return 'not-matched';
  await hook.handler(ctx as never);
  return 'ran';
};

describe('sessionRevokedOutboxPlugin matcher', () => {
  test('matches the three self-service revoke paths and nothing else', () => {
    const plugin = sessionRevokedOutboxPlugin(async () => {});
    const hook = plugin.hooks?.after?.[0];
    if (!hook) throw new Error('plugin defines no after hook');
    const paths = [
      '/revoke-session',
      '/revoke-other-sessions',
      '/revoke-sessions',
      '/sign-in/magic-link',
      '/list-sessions',
    ];
    assert({
      given: 'the three self-service revoke paths and two unrelated paths',
      should: 'match only the three revoke paths',
      actual: paths.map((path) => hook.matcher(context(path, {}) as never)),
      expected: [true, true, true, false, false],
    });
  });
});

describe('sessionRevokedOutboxPlugin handler', () => {
  test('appends once for a successful response with a userId', async () => {
    const appended: string[] = [];
    await runAfterHook(
      async (userId) => void appended.push(userId),
      '/revoke-session',
      { status: true },
      'user-1',
    );
    assert({
      given: 'a {status:true} response and a session userId',
      should: 'append exactly one doorbell for that user',
      actual: appended,
      expected: ['user-1'],
    });
  });

  test('does not append for an APIError response, even with a userId', async () => {
    const appended: string[] = [];
    await runAfterHook(
      async (userId) => void appended.push(userId),
      '/revoke-session',
      new APIError('UNAUTHORIZED'),
      'user-1',
    );
    assert({
      given: 'an APIError response',
      should: 'append nothing',
      actual: appended,
      expected: [],
    });
  });

  test('does not append when the response is missing status:true', async () => {
    const appended: string[] = [];
    await runAfterHook(
      async (userId) => void appended.push(userId),
      '/revoke-session',
      { status: false },
      'user-1',
    );
    assert({
      given: 'a response that is not {status:true}',
      should: 'append nothing',
      actual: appended,
      expected: [],
    });
  });

  test('does not append when no session userId is available', async () => {
    const appended: string[] = [];
    await runAfterHook(
      async (userId) => void appended.push(userId),
      '/revoke-session',
      { status: true },
      undefined,
    );
    assert({
      given: 'a successful response with no session on the context',
      should: 'append nothing',
      actual: appended,
      expected: [],
    });
  });

  test('a failing append is swallowed, never thrown out of the hook', async () => {
    let outcome: 'threw' | 'resolved' = 'resolved';
    try {
      await runAfterHook(
        async () => {
          throw new Error('outbox unavailable');
        },
        '/revoke-other-sessions',
        { status: true },
        'user-1',
      );
    } catch {
      outcome = 'threw';
    }
    assert({
      given: 'an appendSessionRevoked that rejects',
      should: 'resolve the hook anyway, never propagate the failure out of it',
      actual: outcome,
      expected: 'resolved',
    });
  });
});
