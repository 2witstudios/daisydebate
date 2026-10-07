import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { foundationDefinition } from '@daisy/db/reference-formats';
import type { RoundRules } from '@daisy/protocol';

const foundationToRules = (
  definition: typeof foundationDefinition | undefined,
): RoundRules => ({
  version: 2,
  seats: definition?.seats ?? { affirmative: 1, negative: 1, judge: 0 },
  segments: (definition?.segments ?? []).map((segment) => ({
    key: segment.key,
    label: segment.label,
    type: segment.type,
    side: segment.side,
    slot: segment.slot,
    durationMs: segment.defaultDurationMs,
  })),
  inRoundPrep: null,
  countdownMs: 10_000,
  interaction: { crossExMode: 'ordered', yield: null, interruptions: null },
});
import { createDatabase } from '@daisy/db';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  testDatabaseUrl,
  tokenOf,
  withSql,
  counts,
} from './fixtures';
import { uniqueName, identityUserId } from './auth-account-helpers';

import { requireTestServices } from '@daisy/config';

requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;

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
        stored: (await counts(email)).passkeys,
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
        stillStored: (await counts(alice.email)).passkeys,
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
    const originalUserId = identityUserId(originalIdentity.identity);
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
        stored: (await counts(email)).passkeys,
        recoveredUserId: identityUserId(recoveredIdentity.identity),
        matchesOriginal:
          identityUserId(recoveredIdentity.identity) === originalUserId,
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
    const userId = identityUserId(originalIdentity.identity)!;
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
    const roundId = createId();
    const resolution = 'A representative resolution';
    const foundation = await database.getFormat('foundation');
    await database.createRound({
      id: roundId,
      createdByActorId: actorId,
      resolution,
      competitionType: 'casual',
      length: 'full',
      formatId: 'foundation',
      formatVersion: foundation?.version ?? 1,
      presetVersion: null,
      rules: foundationToRules(foundation?.definition),
    });
    const roundBefore = await database.getRound(roundId);

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
    const roundAfter = await database.getRound(roundId);
    await database.close();
    // The account itself is torn down by this file's shared afterAll; the
    // fixture rows this test provisioned directly must go first, or that
    // cleanup's user delete fails the actor's RESTRICT foreign key. The
    // `revokeOtherSessions` call above appends a `session.revoked` row on
    // this actor's inbox (RT-2.2v minor 2): delete it too, or it survives
    // as an orphan once the actor row below is gone.
    await withSql((sql) => sql`DELETE FROM rounds WHERE id = ${roundId}`);
    await withSql(
      (sql) =>
        sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
    );
    await withSql((sql) => sql`DELETE FROM actors WHERE id = ${actorId}`);

    assert({
      given:
        'an account that loses every passkey, recovers by email, removes the lost credential, revokes its other sessions and enrolls a replacement',
      should:
        'keep the same user id, username and round history, end the pre-recovery session and finish with only the replacement passkey stored',
      actual: {
        enrolledLostOk: enrolledLost.verifyResponse.ok,
        recoveredUserId: identityUserId(recoveredIdentity.identity),
        recoveredUsername:
          recoveredIdentity.identity.state === 'member'
            ? recoveredIdentity.identity.username
            : null,
        roundAfter,
        droppedLostOk: droppedLost.ok,
        enrolledReplacementOk: enrolledReplacement.verifyResponse.ok,
        finalPasskeyNames: finalPasskeys.map((row) => row.name),
        originalSessionState: originalAfterRevoke.identity.state,
      },
      expected: {
        enrolledLostOk: true,
        recoveredUserId: userId,
        recoveredUsername: username,
        roundAfter: roundBefore,
        droppedLostOk: true,
        enrolledReplacementOk: true,
        finalPasskeyNames: ['Replacement device'],
        originalSessionState: 'anonymous',
      },
    });
  });
});
