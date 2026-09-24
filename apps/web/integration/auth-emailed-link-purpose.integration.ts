import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createPasskeyFlows } from './auth-passkey-flows';
import { emailOf, linkFrom, tokenOf, userIdOf } from './fixtures';
import { requireTestServices } from '@daisy/config';

/**
 * ISSUE-2: every emailed link is an opaque token whose purpose lives only
 * on the server, as the prefix of its stored SHA3-256 identifier. A token
 * issued for one flow must never redeem through another flow's confirm
 * page, even though both tokens have the same shape.
 */
requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const { redeem, linkTokenFor, mailbox } = flows.account.flows;

describe('ISSUE-2 emailed-link tokens redeem only for their own purpose', () => {
  test('a sign-in token is refused by the email-change confirm page and an email-change token by the sign-in one', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const signInToken = await linkTokenFor(email);
    const before = mailbox.mails.length;
    await flows.changeEmail(cookie, `moved-${uid}@example.test`);
    const approveToken = tokenOf(linkFrom(mailbox.mails[before]!));

    const signInAsEmailChange = await flows.confirmEmailPost(signInToken);
    const emailChangeAsSignIn = await redeem(approveToken);
    const mailsAfterCrossing = mailbox.mails.length;
    // Each token still works through its own page afterwards: refusal
    // came from purpose, not from spending the token.
    const signIn = await redeem(signInToken);
    const approval = await flows.confirmEmailPost(approveToken);

    assert({
      given:
        'a real sign-in token and a real email-change approval token, each offered to the other flow’s confirm page',
      should:
        'refuse both without a session, mail or address change, and still redeem each through its own page',
      actual: {
        signInAsEmailChange: signInAsEmailChange.status,
        emailChangeAsSignIn: [
          emailChangeAsSignIn.status,
          emailChangeAsSignIn.headers.get('location'),
        ],
        crossedCookies:
          signInAsEmailChange.headers.getSetCookie().length +
          emailChangeAsSignIn.headers.getSetCookie().length,
        mailedByCrossing: mailsAfterCrossing - (before + 1),
        emailAfterCrossing: await emailOf(uid),
        signInOwnPage: signIn.headers.getSetCookie().length > 0,
        approvalOwnPage: approval.status,
      },
      expected: {
        signInAsEmailChange: 400,
        emailChangeAsSignIn: [303, '/auth/confirm?error=INVALID_TOKEN'],
        crossedCookies: 0,
        mailedByCrossing: 0,
        emailAfterCrossing: email,
        signInOwnPage: true,
        approvalOwnPage: 303,
      },
    });
  });
});
