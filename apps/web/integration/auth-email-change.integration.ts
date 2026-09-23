import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  newClient,
  origin,
  withSql,
  type CapturedMail,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const suiteStartedAt = new Date().toISOString();
// Backstop for the per-test cleanup below.
afterAll(() =>
  withSql(
    (sql) =>
      sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND created_at >= ${suiteStartedAt}::timestamptz`,
  ),
);

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const confirmEmailRoute = await import('../src/app/auth/confirm-email/route');

const backdateSession = (token: string, hoursAgo: number) =>
  withSql(
    (sql) =>
      sql`UPDATE session SET created_at = now() - (${hoursAgo}::text || ' hours')::interval WHERE token = ${token}`,
  );

const linkFrom = (mail: CapturedMail): URL => {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!found) throw new Error('No link in captured mail');
  return new URL(found);
};

const confirmGet = (link: URL) =>
  confirmEmailRoute.GET(
    new Request(link, { headers: { [CLIENT_IP_HEADER]: newClient() } }),
  );

const confirmPost = (token: string, callbackURL = '/settings/security') =>
  confirmEmailRoute.POST(
    new Request(`${origin}/auth/confirm-email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        [CLIENT_IP_HEADER]: newClient(),
      },
      body: new URLSearchParams({ token, callbackURL }).toString(),
    }),
  );

const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';

const isAuthenticated = async (cookie: string): Promise<boolean> =>
  (await (
    await flows.get('/api/auth/get-session?disableCookieCache=true', cookie)
  ).json()) !== null;

const emailOf = (userId: string) =>
  withSql(async (sql) => {
    const [row] = await sql`SELECT email FROM users WHERE id = ${userId}`;
    return row?.email as string | undefined;
  });

const userIdOf = (email: string) =>
  withSql(async (sql) => {
    const [row] = await sql`SELECT id FROM users WHERE email = ${email}`;
    return row?.id as string | undefined;
  });

/** RT-2.2: outbox rows the email-change completion's revocation appends. */
const sessionRevokedEvents = (actorId: string) =>
  withSql(
    (sql) =>
      sql`SELECT topic FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  ).then((rows) => rows.length);

const cleanupOutboxFor = (actorId: string) =>
  withSql(
    (sql) =>
      sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  );

/**
 * Plan revision 4.10 (ACTOR-1 pending): the outbox append only runs once
 * the actor resolves through `actors.user_id`, and nothing in the signup
 * path creates one yet, so this fixture stands in for ACTOR-1's onboarding
 * insert until that leaf lands. Revocation rows are keyed by `actors.id`,
 * never `userId`, so this returns the actor id the append will use.
 */
const createActorFor = async (userId: string): Promise<string> => {
  const actorId = createId();
  await withSql(
    (sql) =>
      sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${userId})`,
  );
  return actorId;
};

const cleanupActorFor = (userId: string) =>
  withSql((sql) => sql`DELETE FROM actors WHERE user_id = ${userId}`);

describe('AUTH-5.6 change the recovery email', () => {
  test('a fresh session completes the two-hop change, keeping the old address until the new one verifies', async () => {
    const { email, cookie, userId } = { ...(await signUp()), userId: '' };
    const uid = (await userIdOf(email)) ?? '';
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    const started = await flows.changeEmail(cookie, newEmail);

    const confirmMail = flows.account.flows.mailbox.mails[before];
    const confirmLink = linkFrom(confirmMail!);
    // GET only renders; it must not itself approve the change.
    const scanned = await confirmGet(confirmLink);
    const emailAfterScan = await emailOf(uid);
    const approved = await confirmPost(tokenOf(confirmLink));

    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyLink = linkFrom(verifyMail!);
    const verified = await confirmPost(tokenOf(verifyLink));
    const finalEmail = await emailOf(uid);

    assert({
      given:
        'a fresh session requesting an email change, approved and verified in turn',
      should:
        'start without error, leave the old address until verified, and finish on the new address',
      actual: {
        startedOk: started.ok,
        scanStatus: scanned.status,
        emailUnchangedAfterScan: emailAfterScan,
        approvedRedirected: approved.status,
        verifiedRedirected: verified.status,
        finalEmail,
      },
      expected: {
        startedOk: true,
        scanStatus: 200,
        emailUnchangedAfterScan: email,
        approvedRedirected: 303,
        verifiedRedirected: 303,
        finalEmail: newEmail,
      },
    });
    void userId;
  });

  test('completing the change notifies the old address and revokes other sessions', async () => {
    const { email, cookie } = await signUp();
    // A second, independent session for the same account before the change.
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const otherCookie = cookieHeader(
      await redeem(new URL(link as URL).searchParams.get('token') ?? ''),
    );
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    const userId = (await userIdOf(email)) ?? '';
    const actorId = await createActorFor(userId);
    const eventsBefore = await sessionRevokedEvents(actorId);
    try {
      await flows.changeEmail(cookie, newEmail);
      const confirmMail = flows.account.flows.mailbox.mails[before];
      await confirmPost(tokenOf(linkFrom(confirmMail!)));
      const verifyMail = flows.account.flows.mailbox.mails[before + 1];
      const finalResponse = await confirmPost(tokenOf(linkFrom(verifyMail!)));
      const newCookie = cookieHeader(finalResponse);

      assert({
        given:
          'a completed email change with a second, independent prior session',
        should:
          'notify the old address, keep the completing session live, revoke the other one and append a real session.revoked row (RT-2.2)',
        actual: {
          notifiedOldAddress: confirmMail!.to === email,
          completingSessionLive: await isAuthenticated(newCookie),
          otherSessionRevoked: !(await isAuthenticated(otherCookie)),
          outboxEventsAppended:
            (await sessionRevokedEvents(actorId)) - eventsBefore,
        },
        expected: {
          notifiedOldAddress: true,
          completingSessionLive: true,
          otherSessionRevoked: true,
          outboxEventsAppended: 1,
        },
      });
    } finally {
      await cleanupOutboxFor(actorId);
      await cleanupActorFor(userId);
    }
  });

  test('a stale session cannot start an email change', async () => {
    const { cookie } = await signUp();
    const sessionBody = (await (
      await flows.get('/api/auth/get-session?disableCookieCache=true', cookie)
    ).json()) as { session?: { token: string } };
    await backdateSession(sessionBody.session?.token ?? '', 2);
    const attempt = await flows.changeEmail(
      cookie,
      `${createId()}@example.test`,
    );
    assert({
      given: 'a session created outside the fresh window',
      should: 'refuse to start an email change',
      actual: { ok: attempt.ok, status: attempt.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a conflicting email does not disclose the other account and changes nothing', async () => {
    const owner = await signUp();
    const requester = await signUp();
    const before = flows.account.flows.mailbox.mails.length;
    const attempt = await flows.changeEmail(requester.cookie, owner.email);
    assert({
      given: 'a change to an email that already belongs to another account',
      should: 'answer the same shape as success and change nothing',
      actual: {
        ok: attempt.ok,
        requesterEmailUnchanged: await emailOf(
          (await userIdOf(requester.email))!,
        ),
        noNewMailToRequester: flows.account.flows.mailbox.mails
          .slice(before)
          .every((mail) => mail.to !== owner.email),
      },
      expected: {
        ok: true,
        requesterEmailUnchanged: requester.email,
        noNewMailToRequester: true,
      },
    });
  });

  test('a replayed verification link changes nothing', async () => {
    const { email, cookie } = await signUp();
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmLink = linkFrom(flows.account.flows.mailbox.mails[before]!);
    await confirmPost(tokenOf(confirmLink));
    const verifyLink = linkFrom(flows.account.flows.mailbox.mails[before + 1]!);
    const first = await confirmPost(tokenOf(verifyLink));
    const replay = await confirmPost(tokenOf(verifyLink));
    const uid = await userIdOf(newEmail);
    assert({
      given: 'the same verification link redeemed twice',
      should: 'succeed once and leave the account unchanged on replay',
      actual: {
        firstRedirected: first.status,
        replayStatus: replay.status,
        finalEmail: uid ? await emailOf(uid) : null,
      },
      expected: {
        firstRedirected: 303,
        replayStatus: 400,
        finalEmail: newEmail,
      },
    });
    void email;
  });

  test('an invalid token is refused without a same-origin bypass', async () => {
    const crossOrigin = await confirmEmailRoute.POST(
      new Request(`${origin}/auth/confirm-email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://attacker.example',
          [CLIENT_IP_HEADER]: newClient(),
        },
        body: new URLSearchParams({ token: 'not-a-real-token' }).toString(),
      }),
    );
    assert({
      given: 'a forged token from a foreign origin',
      should: 'be refused',
      actual: crossOrigin.ok,
      expected: false,
    });
  });
});
