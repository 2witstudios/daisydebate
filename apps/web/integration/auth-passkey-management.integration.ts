import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import type { Identity } from '@daisy/auth';
import { createDatabase } from '@daisy/db';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import { cookieHeader, testDatabaseUrl, withSql } from './auth-mounted-helpers';
import { uniqueName } from './auth-account-helpers';
import { tokenOf } from './auth-mounted-flows';
import { requireTestServices } from '@daisy/config';

const userIdOf = (identity: Identity): string | null =>
  identity.state === 'member' || identity.state === 'provisional'
    ? identity.principal.userId
    : null;

requireTestServices(process.env);
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

describe('AUTH-5.4 recover from a lost passkey through verified email', () => {
  test('losing every passkey, recovering by email, dropping the lost credential, revoking other sessions and enrolling a replacement preserves identity and debate history', async () => {
    const { email, cookie: originalCookie } = await signUp();
    const username = uniqueName();
    await flows.account.claim(originalCookie, { username });
    const enrolledLost = await flows.enrollPasskey(originalCookie, {
      name: 'Lost device',
    });
    const lostRows = await flows.listPasskeys(originalCookie);
    const [lostPasskey] = (await lostRows.json()) as { id: string }[];

    const originalIdentity = await flows.account.sessionAs(originalCookie);
    const userId = userIdOf(originalIdentity.identity)!;
    // Debate history hangs off the competitive `actors` table (ADR 0029);
    // the username claim above already provisioned this account's human
    // actor in the same transaction (ACTOR-1), so the fixture only reads it
    // to give the account debate history to prove unchanged.
    const database = createDatabase({
      url: testDatabaseUrl as string,
      nextActorId: createId,
    });
    const actor = await database.getActorByUserId(userId);
    const actorId = actor!.id;
    const debateId = createId();
    const resolution = 'A representative resolution';
    await database.createDebate({
      id: debateId,
      createdBy: actorId,
      resolution,
      format: 'foundation',
      snapshot: {
        version: 1,
        id: debateId,
        resolution,
        format: 'foundation',
        rules: (await database.getFormat('foundation'))?.rules,
        phase: 'waiting',
        createdAt: '2026-01-01T00:00:00.000Z',
        participants: [],
      },
      mode: 'casual',
      visibility: 'unlisted',
    });
    const debateBefore = await database.getDebate(debateId);

    // Lose every authenticator: recover through the emailed magic link, not
    // the still-valid original session.
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const recovered = await redeem(tokenOf(link as URL));
    const recoveredCookie = cookieHeader(recovered);

    // Clean up as the recovered account: drop the lost credential, revoke
    // every other session (the pre-recovery one included), then enroll a
    // replacement — the full chained journey, not each step in isolation.
    const droppedLost = await flows.deletePasskey(
      recoveredCookie,
      lostPasskey!.id,
    );
    await flows.revokeOtherSessions(recoveredCookie);
    const enrolledReplacement = await flows.enrollPasskey(recoveredCookie, {
      name: 'Replacement device',
    });
    const finalRows = await flows.listPasskeys(recoveredCookie);
    const finalPasskeys = (await finalRows.json()) as { name: string }[];

    const recoveredIdentity = await flows.account.sessionAs(recoveredCookie);
    const originalAfterRevoke = await flows.account.sessionAs(originalCookie);
    const debateAfter = await database.getDebate(debateId);
    await database.close();
    // The account itself is torn down by this file's shared afterAll; the
    // fixture rows this test provisioned directly must go first, or that
    // cleanup's user delete fails the actor's RESTRICT foreign key. The
    // `revokeOtherSessions` call above appends a `session.revoked` row on
    // this actor's inbox (RT-2.2v minor 2): delete it too, or it survives
    // as an orphan once the actor row below is gone.
    await withSql((sql) => sql`DELETE FROM debates WHERE id = ${debateId}`);
    await withSql(
      (sql) =>
        sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
    );
    await withSql((sql) => sql`DELETE FROM actors WHERE id = ${actorId}`);

    assert({
      given:
        'an account that loses every passkey, recovers by email, removes the lost credential, revokes its other sessions and enrolls a replacement',
      should:
        'keep the same user id, username and debate history, end the pre-recovery session and finish with only the replacement passkey stored',
      actual: {
        enrolledLostOk: enrolledLost.verifyResponse.ok,
        recoveredUserId: userIdOf(recoveredIdentity.identity),
        recoveredUsername:
          recoveredIdentity.identity.state === 'member'
            ? recoveredIdentity.identity.username
            : null,
        debateAfter,
        droppedLostOk: droppedLost.ok,
        enrolledReplacementOk: enrolledReplacement.verifyResponse.ok,
        finalPasskeyNames: finalPasskeys.map((row) => row.name),
        originalSessionState: originalAfterRevoke.identity.state,
      },
      expected: {
        enrolledLostOk: true,
        recoveredUserId: userId,
        recoveredUsername: username,
        debateAfter: debateBefore,
        droppedLostOk: true,
        enrolledReplacementOk: true,
        finalPasskeyNames: ['Replacement device'],
        originalSessionState: 'anonymous',
      },
    });
  });
});

describe('ISSUE-5 AC6 passkey add/remove security notifications', () => {
  test('registering a passkey sends a passkey-added notice to the account email', async () => {
    const carol = await signUp();
    const before = flows.account.flows.mailbox.mails.length;
    await flows.enrollPasskey(carol.cookie, { name: 'Carol phone' });
    const mail = flows.account.flows.mailbox.mails[before];
    assert({
      given: 'a real /passkey/verify-registration round-trip',
      should: 'deliver a passkey-added notice to the account address',
      actual: {
        to: mail?.to,
        subjectMentionsAdded: mail?.subject.toLowerCase().includes('added'),
      },
      expected: { to: carol.email, subjectMentionsAdded: true },
    });
  });

  test('deleting a passkey sends a passkey-removed notice to the account email', async () => {
    const dave = await signUp();
    const { verifyResponse } = await flows.enrollPasskey(dave.cookie, {
      name: 'Dave key',
    });
    const created = (await verifyResponse.clone().json()) as { id: string };
    const before = flows.account.flows.mailbox.mails.length;
    await flows.deletePasskey(dave.cookie, created.id);
    const mail = flows.account.flows.mailbox.mails[before];
    assert({
      given: 'a real /passkey/delete-passkey round-trip',
      should: 'deliver a passkey-removed notice to the account address',
      actual: {
        to: mail?.to,
        subjectMentionsRemoved: mail?.subject.toLowerCase().includes('removed'),
      },
      expected: { to: dave.email, subjectMentionsRemoved: true },
    });
  });
});
