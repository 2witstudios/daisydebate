import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  emailOf,
  linkFrom,
  tokenOf,
  userIdOf,
  withSql,
} from './fixtures';
import { requireTestServices } from '@daisy/config';

requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const { mails } = flows.account.flows.mailbox;

const sessionCountOf = (userId: string) =>
  withSql(
    (sql) =>
      sql`SELECT count(*)::int AS n FROM session WHERE user_id = ${userId}`,
  ).then((rows) => rows[0]?.n as number);

/** A second account completes its own change to `address`, both hops. */
const claimByAnotherAccount = async (address: string) => {
  const other = await signUp();
  const before = mails.length;
  await flows.changeEmail(other.cookie, address);
  await flows.confirmEmailPost(tokenOf(linkFrom(mails[before]!)));
  await flows.confirmEmailPost(tokenOf(linkFrom(mails[before + 1]!)));
  return (await userIdOf(address)) ?? '';
};

// ADR 0025: redemption refuses a claim whose account no longer holds the
// old address, or whose new address was taken in the meantime (ISSUE-2).
describe('ISSUE-2 email-change claim guards at redemption', () => {
  test('a stale approval, redeemed after the account moved to another address, changes nothing', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const before = mails.length;
    // A change to a claimed address is requested; its approval is left
    // unredeemed.
    await flows.changeEmail(cookie, `${createId()}@example.test`);
    const staleApproval = tokenOf(linkFrom(mails[before]!));
    // The account then completes a different change, so it no longer holds
    // the address the stale approval was issued for.
    const { newEmail, verifyToken } = await flows.confirmedEmailChange(cookie);
    await flows.confirmEmailPost(verifyToken);
    const mailsBefore = mails.length;
    const sessionsBefore = await sessionCountOf(uid);
    const redeemed = await flows.confirmEmailPost(staleApproval);
    assert({
      given:
        'an approval link issued before the account completed a different email change',
      should:
        'refuse it with no mail to the claimed address, no address change and no session',
      actual: {
        status: redeemed.status,
        sessionCookie: cookieHeader(redeemed),
        newMails: mails.length - mailsBefore,
        finalEmail: await emailOf(uid),
        sessionsAdded: (await sessionCountOf(uid)) - sessionsBefore,
      },
      expected: {
        status: 400,
        sessionCookie: '',
        newMails: 0,
        finalEmail: newEmail,
        sessionsAdded: 0,
      },
    });
  });

  test('an approval whose new address another account claimed meanwhile mails nothing', async () => {
    const requester = await signUp();
    const requesterId = (await userIdOf(requester.email)) ?? '';
    const before = mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(requester.cookie, newEmail);
    const approval = tokenOf(linkFrom(mails[before]!));
    await claimByAnotherAccount(newEmail);
    const mailsBefore = mails.length;
    const redeemed = await flows.confirmEmailPost(approval);
    assert({
      given:
        "an approval link redeemed after another account took the change's new address",
      should:
        "refuse it without mailing a verification link to the other account's address or changing anything",
      actual: {
        status: redeemed.status,
        newMails: mails.length - mailsBefore,
        requesterEmail: await emailOf(requesterId),
      },
      expected: { status: 400, newMails: 0, requesterEmail: requester.email },
    });
  });

  test('a verification link whose new address another account claimed meanwhile changes nothing', async () => {
    const requester = await signUp();
    const requesterId = (await userIdOf(requester.email)) ?? '';
    const { newEmail, verifyToken } = await flows.confirmedEmailChange(
      requester.cookie,
    );
    const otherId = await claimByAnotherAccount(newEmail);
    const sessionsBefore = await sessionCountOf(requesterId);
    let redeemed!: Response;
    const events = await flows.recordedEvents(async () => {
      redeemed = await flows.confirmEmailPost(verifyToken);
    });
    assert({
      given:
        'a verification link redeemed after another account took its new address',
      should:
        'refuse it cleanly (not by a failed write), leaving both accounts on their addresses with no session issued',
      actual: {
        status: redeemed.status,
        unhandledFailure: events.includes('request.unhandled'),
        sessionCookie: cookieHeader(redeemed),
        requesterEmail: await emailOf(requesterId),
        otherEmail: await emailOf(otherId),
        sessionsAdded: (await sessionCountOf(requesterId)) - sessionsBefore,
      },
      expected: {
        status: 400,
        unhandledFailure: false,
        sessionCookie: '',
        requesterEmail: requester.email,
        otherEmail: newEmail,
        sessionsAdded: 0,
      },
    });
  });
});
