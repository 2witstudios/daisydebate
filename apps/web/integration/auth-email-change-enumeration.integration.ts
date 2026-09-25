import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import { linkFrom, tokenOf, userIdOf } from './fixtures';
import { requireTestServices } from '@daisy/config';

/**
 * ISSUE-119: a signed-in account asking /change-email for a new address
 * must not learn whether that address has an account. Before, a free
 * address mailed the approval notice to the requester's own inbox and a
 * taken one answered at once and mailed nothing (ADR 0025).
 */
requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const { mails } = flows.account.flows.mailbox;

type Mail = (typeof mails)[number];

/** A mail as its recipient reads it, with its one link's token blanked. */
const asRead = (mail: Mail) => ({
  to: mail.to,
  subject: mail.subject,
  text: mail.text.replace(/token=[\w-]+/, 'token=…'),
});

/** Asks for a change to `newEmail`: the answer and every mail it sent. */
const requestChange = async (cookie: string, newEmail: string) => {
  const before = mails.length;
  const response = await flows.changeEmail(cookie, newEmail);
  return {
    status: response.status,
    body: await response.text(),
    sent: mails.slice(before),
  };
};

/** Redeems an approval: the confirm page's answer and every mail it sent. */
const approve = async (approval: Mail) => {
  const before = mails.length;
  const response = await flows.confirmEmailPost(tokenOf(linkFrom(approval)));
  return {
    status: response.status,
    location: response.headers.get('location'),
    cookies: response.headers.getSetCookie().length,
    sent: mails.slice(before),
  };
};

describe('ISSUE-119 an email change does not reveal whether the new address has an account', () => {
  test('a free and a taken new address get the same answer and the same mail in the requester’s inbox', async () => {
    const requester = await signUp();
    const { email: taken } = await signUp();
    const free = `${createId()}@example.test`;
    const toFree = await requestChange(requester.cookie, free);
    const toTaken = await requestChange(requester.cookie, taken);
    assert({
      given:
        'a signed-in account with a deliverable address asking the real route for a free address, then for another account’s',
      should:
        'answer both with the same status and body, and mail the requester one identical approval notice each, nothing to either new address',
      actual: {
        answers: [toTaken, toFree].map(({ status, body }) => ({
          status,
          body,
        })),
        inbox: [toTaken, toFree].map(({ sent }) => sent.map(asRead)),
      },
      expected: {
        answers: [
          { status: 200, body: '{"status":true}' },
          { status: 200, body: '{"status":true}' },
        ],
        inbox: [
          [asRead({ ...toFree.sent[0]!, to: requester.email })],
          [asRead({ ...toFree.sent[0]!, to: requester.email })],
        ],
      },
    });
  });

  test('approving either change answers the same; only the taken address’s owner hears, and nothing is claimed', async () => {
    const requester = await signUp();
    const { email: taken } = await signUp();
    const takenId = await userIdOf(taken);
    const free = `${createId()}@example.test`;
    const { sent: freeApproval } = await requestChange(requester.cookie, free);
    const { sent: takenApproval } = await requestChange(
      requester.cookie,
      taken,
    );
    const approvedFree = await approve(freeApproval[0]!);
    const approvedTaken = await approve(takenApproval[0]!);
    const answer = ({ status, location, cookies }: typeof approvedFree) => ({
      status,
      location,
      cookies,
    });
    const newInbox = ({ sent }: typeof approvedFree) =>
      sent.map((mail) => ({
        to: mail.to,
        path: linkFrom(mail).pathname,
        redeems: tokenOf(linkFrom(mail)) !== '',
      }));
    assert({
      given:
        'the requester’s own approval links for a free address and for another account’s, redeemed through the confirm page',
      should:
        'answer both alike, send the free address a confirmation link and the taken one a notice that redeems nothing, and leave the taken address with its owner',
      actual: {
        answers: [answer(approvedTaken), answer(approvedFree)],
        free: newInbox(approvedFree),
        taken: newInbox(approvedTaken),
        takenHeldBy: await userIdOf(taken),
      },
      expected: {
        answers: [answer(approvedFree), answer(approvedFree)],
        free: [{ to: free, path: '/auth/confirm-email', redeems: true }],
        taken: [{ to: taken, path: '/settings/security', redeems: false }],
        takenHeldBy: takenId,
      },
    });
  });
});
