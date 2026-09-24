import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import {
  authTestEnv,
  composeAuthServer,
  memoryTables,
} from './auth-server.test-support';
import { emailedLinkIdentifier } from './emailed-link-token';
import type { AuthEmailMessage } from './server';

setupRitewayBun();

const origin = authTestEnv.PUBLIC_APP_URL;
const oldEmail = 'player@daisy.example.com';
const newEmail = 'moved@daisy.example.com';

const linkIn = (message: AuthEmailMessage | undefined) =>
  new URL(message?.text.match(/https?:\/\/\S+/)?.[0] ?? 'http://x.invalid');

/**
 * The composed auth server over in-memory tables, signed in through a real
 * magic link. Expiry is stamped from the injected clock and checked by
 * Better Auth against the ambient one, so this suite injects the system
 * clock.
 */
async function signedIn() {
  const db = memoryTables();
  const sent: AuthEmailMessage[] = [];
  const server = composeAuthServer(
    {
      clock: systemClock,
      emailSender: { send: async (message) => void sent.push(message) },
    },
    db,
  );
  const call = (path: string, init: RequestInit = {}, cookie = '') =>
    server.instance.handler(
      new Request(`${origin}/api/auth${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          origin,
          ...(cookie ? { cookie } : {}),
          ...init.headers,
        },
      }),
    );
  const signIn = async (address: string) => {
    await call('/sign-in/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: address }),
    });
    const token = linkIn(sent.at(-1)).searchParams.get('token');
    const response = await call(`/magic-link/verify?token=${token}`);
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  };
  const cookie = await signIn(oldEmail);
  const requestChange = (email: string) =>
    call(
      '/change-email',
      { method: 'POST', body: JSON.stringify({ newEmail: email }) },
      cookie,
    );
  const redeem = (token: string) =>
    call('/email-change/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  const email = () => (db.user[0] as { email: string }).email;
  return { db, sent, signIn, requestChange, redeem, email };
}

describe('ISSUE-2 email change on opaque stored tokens', () => {
  test('the approval link carries only an opaque token whose SHA3-256 digest, purpose and subject are stored', async () => {
    const { db, sent, requestChange } = await signedIn();
    const response = await requestChange(newEmail);
    const link = linkIn(sent[1]);
    const token = link.searchParams.get('token') ?? '';
    const [row] = db.verification.filter((stored) =>
      String(stored.identifier).startsWith('email-change-'),
    ) as Array<{ identifier: string; value: string }>;
    const userId = (db.user[0] as { id: string }).id;
    assert({
      given: 'a signed-in, fresh session asking to change its email',
      should:
        'mail the old address a confirm link holding only an opaque 256-bit token, stored as its purpose and SHA3-256 digest with the account and both addresses',
      actual: {
        status: response.status,
        to: sent[1]?.to,
        path: link.pathname,
        params: [...link.searchParams.keys()],
        opaque256: /^[A-Za-z0-9_-]{43}$/.test(token),
        identifier: row?.identifier,
        subject: JSON.parse(row?.value ?? '{}'),
        tokenStored: JSON.stringify(db.verification).includes(token),
      },
      expected: {
        status: 200,
        to: oldEmail,
        path: '/auth/confirm-email',
        params: ['token'],
        opaque256: true,
        identifier: emailedLinkIdentifier('email-change-approve', token),
        subject: { userId, email: oldEmail, newEmail },
        tokenStored: false,
      },
    });
  });

  test('approving mails the new address a second opaque link; verifying switches the address and signs in', async () => {
    const { sent, requestChange, redeem, email } = await signedIn();
    await requestChange(newEmail);
    const approveToken = linkIn(sent[1]).searchParams.get('token') ?? '';
    const approved = await redeem(approveToken);
    const verifyLink = linkIn(sent[2]);
    const emailAfterApproval = email();
    const verified = await redeem(verifyLink.searchParams.get('token') ?? '');
    assert({
      given: 'the approval token, then the verification token it produced',
      should:
        'mail the new address only after approval, keep the old address until verification, then switch it and issue a session',
      actual: {
        approved: approved.status,
        approvedCookies: approved.headers.getSetCookie().length,
        secondTo: sent[2]?.to,
        secondParams: [...verifyLink.searchParams.keys()],
        emailAfterApproval,
        verified: verified.status,
        sessionIssued: verified.headers.getSetCookie().length > 0,
        finalEmail: email(),
      },
      expected: {
        approved: 200,
        approvedCookies: 0,
        secondTo: newEmail,
        secondParams: ['token'],
        emailAfterApproval: oldEmail,
        verified: 200,
        sessionIssued: true,
        finalEmail: newEmail,
      },
    });
  });

  test('every token is single-use and only redeems for its own purpose', async () => {
    const { sent, requestChange, redeem, email } = await signedIn();
    const signInToken = linkIn(sent[0]).searchParams.get('token') ?? '';
    await requestChange(newEmail);
    const approveToken = linkIn(sent[1]).searchParams.get('token') ?? '';
    const asEmailChange = await redeem(signInToken);
    await redeem(approveToken);
    const approvalReplay = await redeem(approveToken);
    const verifyToken = linkIn(sent[2]).searchParams.get('token') ?? '';
    await redeem(verifyToken);
    const verifyReplay = await redeem(verifyToken);
    assert({
      given:
        'a sign-in token offered to the email change, then each email-change token redeemed twice',
      should:
        'refuse the foreign-purpose token and every replay with 400, changing the address exactly once',
      actual: {
        signInTokenAsEmailChange: asEmailChange.status,
        approvalReplay: approvalReplay.status,
        mailsAfterReplay: sent.length,
        verifyReplay: verifyReplay.status,
        finalEmail: email(),
      },
      expected: {
        signInTokenAsEmailChange: 400,
        approvalReplay: 400,
        mailsAfterReplay: 3,
        verifyReplay: 400,
        finalEmail: newEmail,
      },
    });
  });

  test('the current address is refused and an address held by another account changes nothing', async () => {
    const { sent, signIn, requestChange, email } = await signedIn();
    const takenEmail = 'taken@daisy.example.com';
    await signIn(takenEmail);
    const before = sent.length;
    const same = await requestChange(oldEmail.toUpperCase());
    const taken = await requestChange(takenEmail);
    assert({
      given: 'a change to the current address, then to another account’s',
      should:
        'refuse the unchanged address, and answer the taken one like success without mailing anyone',
      actual: {
        same: same.status,
        taken: taken.status,
        mailed: sent.length - before,
        email: email(),
      },
      expected: { same: 400, taken: 200, mailed: 0, email: oldEmail },
    });
  });
});
