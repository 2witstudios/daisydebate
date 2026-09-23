import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import { emailOf, linkFrom, tokenOf, userIdOf } from './fixtures';
import { requireTestServices } from '@daisy/config';

/**
 * ISSUE-3: split from `auth-email-change.integration.ts` to keep each file
 * under the lint's line limit. Proves the mounted `/api/auth` route refuses
 * to redeem `/verify-email` directly, so a linked-to change never completes
 * outside the same-origin confirm page.
 */
requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;

describe('ISSUE-3: direct GET redemption of /verify-email is refused', () => {
  test('a direct GET never verifies the change, leaving the token to verify through the confirm page', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmMail = flows.account.flows.mailbox.mails[before];
    await flows.confirmEmailPost(tokenOf(linkFrom(confirmMail!)));
    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyToken = tokenOf(linkFrom(verifyMail!));

    const direct = await flows.get(
      `/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`,
    );
    const emailAfterDirectAttempt = await emailOf(uid);
    const legitimate = await flows.confirmEmailPost(verifyToken);
    const finalEmail = await emailOf(uid);

    assert({
      given: 'a direct GET to the mounted /api/auth/verify-email link',
      should:
        'answer 404 with no cookie, changing nothing, and leave the token to verify normally afterward through the confirm page',
      actual: {
        directStatus: direct.status,
        directCookies: direct.headers.getSetCookie().length,
        emailAfterDirectAttempt,
        legitimateStatus: legitimate.status,
        finalEmail,
      },
      expected: {
        directStatus: 404,
        directCookies: 0,
        emailAfterDirectAttempt: email,
        legitimateStatus: 303,
        finalEmail: newEmail,
      },
    });
  });
});
