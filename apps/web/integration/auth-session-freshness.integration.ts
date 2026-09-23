import { setupRitewayBun, assert, describe, test } from 'riteway/bun';
import { createPasskeyFlows } from './auth-passkey-flows';
import { withSql } from './auth-mounted-helpers';

/**
 * ADR 0020's fresh-session gate on sensitive session/passkey operations,
 * split from `auth-session-management.integration.ts` to keep each file
 * under the lint's line limit.
 */
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
/** Backdates a session row's createdAt so the fresh-session gate refuses it. */
const backdateSession = (token: string, hoursAgo: number) =>
  withSql(
    (sql) =>
      sql`UPDATE session SET created_at = now() - (${hoursAgo}::text || ' hours')::interval WHERE token = ${token}`,
  );

describe('AUTH-5.5 fresh-session gate', () => {
  test('a stale session is refused for revoking sessions and requires fresh authentication', async () => {
    const { cookie } = await signUp();
    const token = (await flows.serverSession(cookie))?.session.token ?? '';
    await backdateSession(token, 2);
    const stale = await flows.revokeSessions(cookie);
    assert({
      given: 'a live, valid session created outside the fresh window',
      should: 'refuse revoke-sessions and require fresh authentication',
      actual: { ok: stale.ok, status: stale.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a stale session is refused for revoking a single other session', async () => {
    const { cookie } = await signUp();
    const token = (await flows.serverSession(cookie))?.session.token ?? '';
    await backdateSession(token, 2);
    const stale = await flows.revokeSession(cookie, 'irrelevant-token');
    assert({
      given: 'a live, valid session created outside the fresh window',
      should: 'refuse revoke-session and require fresh authentication',
      actual: { ok: stale.ok, status: stale.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a stale session is refused for revoking every other session', async () => {
    const { cookie } = await signUp();
    const token = (await flows.serverSession(cookie))?.session.token ?? '';
    await backdateSession(token, 2);
    const stale = await flows.revokeOtherSessions(cookie);
    assert({
      given: 'a live, valid session created outside the fresh window',
      should: 'refuse revoke-other-sessions and require fresh authentication',
      actual: { ok: stale.ok, status: stale.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a stale session is refused for removing a passkey', async () => {
    const { cookie } = await signUp();
    const { verifyResponse, credential } = await flows.enrollPasskey(cookie, {
      name: 'Old device',
    });
    void credential;
    const token = (await flows.serverSession(cookie))?.session.token ?? '';
    await backdateSession(token, 2);
    const listed = await flows.listPasskeys(cookie);
    const rows = (await listed.json()) as { id: string }[];
    const removed = await flows.deletePasskey(cookie, rows[0]!.id);
    assert({
      given: 'an enrolled passkey and a since-staled session',
      should: 'refuse the removal and require fresh authentication',
      actual: {
        enrolled: verifyResponse.ok,
        removeOk: removed.ok,
        removeStatus: removed.status,
      },
      expected: { enrolled: true, removeOk: false, removeStatus: 403 },
    });
  });
});
