import { createHash } from 'node:crypto';
import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { redisKey } from '@daisy/redis';
import { createAccountFlows } from './auth-account-helpers';
import { statuses } from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { requireTestServices } from '@daisy/config';

/**
 * ISSUE-54 AC2: the whole-application magic-link ceilings (120/minute,
 * 3,000/day) protect Resend quota and domain reputation, but before this
 * they counted every request, so one client rotating IPv6 /128 addresses
 * and plus-addressed recipients could spend the day's allowance and deny
 * magic-link sign-in to every account. They now meter only mail to
 * addresses with no account (sign-up links): sign-in to an existing
 * account is bounded by that account's own recipient ceilings instead, so
 * draining the global ceiling delays new sign-ups but never denies sign-in.
 */
const { redisUrl } = requireTestServices(process.env);
setupRitewayBun();

const accounts = createAccountFlows();
const { flows } = accounts;
const { testApp, mailbox, newClient, fresh } = flows;

const magicLink = (email: string) =>
  flows.authRoute.POST(
    flows.jsonPost(
      '/api/auth/sign-in/magic-link',
      { email },
      { [CLIENT_IP_HEADER]: newClient() },
    ),
  );

/** The global minute window elapsing: its real counter key expires. */
const elapseGlobalMinute = async () => {
  const client = new RedisClient(redisUrl);
  try {
    await client.del(
      redisKey(
        testApp.redisNamespace,
        'rl',
        createHash('sha3-256')
          .update('auth:magic-link:global:60')
          .digest('hex'),
      ),
    );
  } finally {
    client.close();
  }
};

describe('ISSUE-54 the global mail ceiling cannot deny sign-in', () => {
  test('with the global minute ceiling drained by new-address requests, existing accounts still get their sign-in links', async () => {
    const existing = [
      (await accounts.signUp()).email,
      (await accounts.signUp()).email,
      (await accounts.signUp()).email,
    ];
    await elapseGlobalMinute();

    // One actor draining the ceiling: every request its own client address
    // (IPv6 /128 rotation) and its own new recipient (plus-addressing).
    const drain = await Promise.all(
      Array.from({ length: 125 }, () => magicLink(fresh())),
    );
    const before = mailbox.mails.length;
    const [signIns, laterSignUps] = await Promise.all([
      Promise.all(existing.map((email) => magicLink(email))),
      Promise.all(Array.from({ length: 10 }, () => magicLink(fresh()))),
    ]);
    const mailedAccounts = mailbox.mails
      .slice(before)
      .filter((mail) => existing.includes(mail.to)).length;

    assert({
      given:
        '125 simultaneous new-address requests from distinct clients against real Redis, then sign-in requests for three existing accounts racing ten more new addresses',
      should:
        'admit exactly 120 new addresses, and admit and mail every existing account while the later new addresses are denied',
      actual: {
        drain: statuses(drain),
        signIns: statuses(signIns),
        mailedAccounts,
        laterSignUps: statuses(laterSignUps),
      },
      expected: {
        drain: { 200: 120, 429: 5 },
        signIns: { 200: 3 },
        mailedAccounts: 3,
        laterSignUps: { 429: 10 },
      },
    });
  });
});
