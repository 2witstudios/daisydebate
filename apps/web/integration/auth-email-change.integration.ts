import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  newClient,
  origin,
  withSql,
  type CapturedMail,
} from './auth-mounted-helpers';
import {
  cleanupActorFor,
  cleanupOutboxFor,
  createActorFor,
  sessionRevokedEvents,
} from './auth-outbox-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

/** Every actor id this suite has created, for the `afterAll` backstop below. */
const suiteActorIds: string[] = [];

const trackedCreateActorFor = async (userId: string): Promise<string> => {
  const actorId = await createActorFor(userId);
  suiteActorIds.push(actorId);
  return actorId;
};

/**
 * Every user id this suite's `signUp()` calls have created (RT-2.2f-r2:
 * these tests change the account's email mid-run, so cleanup keys on the
 * user id resolved at sign-up, never the original or final address).
 */
const suiteUserIds: string[] = [];

// Backstop for the per-test cleanup below, scoped to the actors and users
// this suite itself created (RT-2.2v nit, RT-2.2f-r2): never a time-window
// sweep that could delete another suite's rows running concurrently
// against the same `TEST_DATABASE_URL`. `actors.user_id` is
// `onDelete: 'restrict'`, so actors are cleared before their users.
afterAll(async () => {
  await Promise.all(suiteActorIds.map((actorId) => cleanupOutboxFor(actorId)));
  await Promise.all(
    suiteUserIds.map((userId) =>
      withSql((sql) => sql`DELETE FROM actors WHERE user_id = ${userId}`),
    ),
  );
  await Promise.all(
    suiteUserIds.map((userId) =>
      withSql((sql) => sql`DELETE FROM users WHERE id = ${userId}`),
    ),
  );
});

const flows = await createPasskeyFlows();
const { signUp: accountSignUp } = flows.account;
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

/** Signs up and tracks the new user id for the `afterAll` cleanup above, before any test changes its email. */
const signUp = async () => {
  const result = await accountSignUp();
  const userId = await userIdOf(result.email);
  if (userId) suiteUserIds.push(userId);
  return result;
};

/** Swaps the shared logger for a recorder for the duration of `work` (AUTH-6.4). */
async function recordedEvents(work: () => Promise<void>): Promise<string[]> {
  const resources = flows.account.flows.getResources();
  const events: string[] = [];
  const original = resources.logger;
  resources.logger = {
    log: (event: string) => {
      events.push(event);
    },
    child() {
      return this;
    },
  };
  try {
    await work();
  } finally {
    resources.logger = original;
  }
  return events;
}

describe('AUTH-5.6 change the recovery email', () => {
  test('requesting a change and verifying the new address each emit their own lifecycle event (AUTH-6.4)', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    const requestEvents = await recordedEvents(async () => {
      await flows.changeEmail(cookie, newEmail);
    });
    const confirmLink = linkFrom(flows.account.flows.mailbox.mails[before]!);
    await confirmPost(tokenOf(confirmLink));
    const verifyLink = linkFrom(flows.account.flows.mailbox.mails[before + 1]!);
    const verifyEvents = await recordedEvents(async () => {
      await confirmPost(tokenOf(verifyLink));
    });
    assert({
      given:
        'a fresh session requesting a change, then verifying the new address',
      should:
        'emit auth.email_change.requested and auth.email_change.verified respectively',
      actual: {
        requested: requestEvents.includes('auth.email_change.requested'),
        verified: verifyEvents.includes('auth.email_change.verified'),
      },
      expected: { requested: true, verified: true },
    });
    void uid;
  });

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
    const actorId = await trackedCreateActorFor(userId);
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
