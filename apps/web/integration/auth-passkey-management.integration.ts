import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { createPasskeyFlows } from './auth-passkey-flows';
import { cookieHeader, withSql } from './auth-mounted-helpers';
import { tokenOf } from './auth-mounted-flows';

const userIdOf = (identity: Identity): string | null =>
  identity.state === 'member' || identity.state === 'provisional'
    ? identity.principal.userId
    : null;

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;

const passkeyCount = (email: string) =>
  withSql(async (sql) => {
    const [row] = await sql`
      SELECT count(*)::int AS c FROM passkey p
      JOIN users u ON u.id = p.user_id
      WHERE u.email = ${email}
    `;
    return (row?.c as number) ?? 0;
  });

describe('AUTH-5.3 list, rename and remove owned passkeys', () => {
  test('listing returns only the current account’s passkeys with names and creation metadata', async () => {
    const alice = await signUp();
    const bob = await signUp();
    await flows.enrollPasskey(alice.cookie, { name: 'Alice laptop' });
    await flows.enrollPasskey(bob.cookie, { name: 'Bob laptop' });
    const listed = await flows.listPasskeys(alice.cookie);
    const rows = (await listed.json()) as { name: string; createdAt: string }[];
    assert({
      given: 'two accounts, each with one passkey',
      should: "list only the caller's own passkey",
      actual: {
        count: rows.length,
        name: rows[0]?.name,
        hasCreatedAt: Boolean(rows[0]?.createdAt),
      },
      expected: { count: 1, name: 'Alice laptop', hasCreatedAt: true },
    });
  });

  test('rename and remove succeed for an owned passkey', async () => {
    const { email, cookie } = await signUp();
    const { credential } = await flows.enrollPasskey(cookie, {
      name: 'Old name',
    });
    const listed = await flows.listPasskeys(cookie);
    const [row] = (await listed.json()) as { id: string }[];
    const renamed = await flows.renamePasskey(cookie, row!.id, 'New name');
    const afterRename = await flows.listPasskeys(cookie);
    const [renamedRow] = (await afterRename.json()) as { name: string }[];
    const removed = await flows.deletePasskey(cookie, row!.id);
    assert({
      given: 'a passkey owned by the caller',
      should:
        'allow rename then removal, persisting the new name before removal and leaving none stored',
      actual: {
        renamed: renamed.ok,
        persistedName: renamedRow?.name,
        removed: removed.ok,
        stored: await passkeyCount(email),
      },
      expected: {
        renamed: true,
        persistedName: 'New name',
        removed: true,
        stored: 0,
      },
    });
    void credential;
  });

  test("another user's credential id is refused for rename and removal", async () => {
    const alice = await signUp();
    const bob = await signUp();
    await flows.enrollPasskey(alice.cookie, { name: 'Alice laptop' });
    const listed = await flows.listPasskeys(alice.cookie);
    const [row] = (await listed.json()) as { id: string }[];
    const renamedByBob = await flows.renamePasskey(
      bob.cookie,
      row!.id,
      'Stolen',
    );
    const removedByBob = await flows.deletePasskey(bob.cookie, row!.id);
    const afterAttempts = await flows.listPasskeys(alice.cookie);
    const [aliceRow] = (await afterAttempts.json()) as { name: string }[];
    assert({
      given: "bob naming alice's credential id",
      should:
        "refuse both modifications and leave alice's credential name untouched",
      actual: {
        renameOk: renamedByBob.ok,
        removeOk: removedByBob.ok,
        aliceName: aliceRow?.name,
        stillStored: await passkeyCount(alice.email),
      },
      expected: {
        renameOk: false,
        removeOk: false,
        aliceName: 'Alice laptop',
        stillStored: 1,
      },
    });
  });

  test('removing the final passkey preserves magic-link access', async () => {
    const { email, cookie } = await signUp();
    const listed = await flows.enrollPasskey(cookie, { name: 'Only one' });
    const rows = await flows.listPasskeys(cookie);
    const [row] = (await rows.json()) as { id: string }[];
    await flows.deletePasskey(cookie, row!.id);
    const { requestLink, redeem } = flows.account.flows;
    const { response, link } = await requestLink(email);
    const originalIdentity = await flows.account.sessionAs(cookie);
    const originalUserId = userIdOf(originalIdentity.identity);
    const recovered = await redeem(tokenOf(link as URL));
    const recoveredIdentity = await flows.account.sessionAs(
      cookieHeader(recovered),
    );
    assert({
      given: 'an account whose last passkey was just removed',
      should:
        'let the requested magic link actually authenticate the same account',
      actual: {
        removedFirst: listed.verifyResponse.ok,
        linkRequested: response.ok,
        stored: await passkeyCount(email),
        recoveredUserId: userIdOf(recoveredIdentity.identity),
        matchesOriginal:
          userIdOf(recoveredIdentity.identity) === originalUserId,
      },
      expected: {
        removedFirst: true,
        linkRequested: true,
        stored: 0,
        recoveredUserId: originalUserId,
        matchesOriginal: true,
      },
    });
  });
});
