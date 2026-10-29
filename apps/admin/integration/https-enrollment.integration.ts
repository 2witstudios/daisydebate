import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { beginEnrollment, finishEnrollment } from '../src/auth/enrollment';
import { issueEnrollment } from '../src/auth/issue-enrollment';
import { softAuthenticator } from '../src/auth/soft-authenticator.test-support';
import { beginSignIn, finishSignIn } from '../src/auth/sign-in';
import { operatorCredentials, operatorSessions } from '../src/db/schema';
import {
  address,
  enrollmentToken,
  registration,
  testDeps,
  suiteDatabase,
} from './admin.test-support';
requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

test('an additional HTTPS passkey retains the existing credential', async () => {
  const local = testDeps(db);
  const oldToken = await enrollmentToken(local);
  const previous = await registration(local, oldToken, 71);
  const first = await finishEnrollment(local, {
    token: oldToken,
    address,
    response: previous.response,
  });
  const https = {
    ...local,
    ceremony: {
      origin: 'https://daisy-admin.tail51baf2.ts.net',
      rpId: 'daisy-admin.tail51baf2.ts.net',
    },
  };
  const link = await issueEnrollment(https, {
    name: 'owner',
    mode: 'additional',
  });
  if (!link.ok) throw new Error('Additional enrollment refused');
  const token = link.url.split('#')[1] ?? '';
  const begun = await beginEnrollment(https, { token, address });
  if (!begun.ok) throw new Error('HTTPS enrollment refused');
  const phone = await softAuthenticator(72);
  const added = await finishEnrollment(https, {
    token,
    address,
    response: await phone.register(begun.options.challenge, https.ceremony),
  });
  const rows = await db.select().from(operatorCredentials);
  const signIn = await beginSignIn(https, { address });
  if (!signIn.ok) throw new Error('HTTPS sign-in refused');
  const refused = await finishSignIn(https, {
    address,
    presented: null,
    response: await previous.device.assert(
      signIn.options.challenge,
      local.ceremony,
      1,
    ),
  });
  const before = await db.select().from(operatorSessions);
  const retry = await beginSignIn(https, { address });
  if (!retry.ok) throw new Error('HTTPS sign-in retry refused');
  const accepted = await finishSignIn(https, {
    address,
    presented: null,
    response: await phone.assert(retry.options.challenge, https.ceremony, 1),
  });
  assert({
    given: 'an existing localhost credential and --additional HTTPS enrollment',
    should:
      'preserve both credentials without revocation and issue no session for the wrong RP',
    actual: [
      first.ok,
      added.ok,
      link.url.startsWith(`${https.ceremony.origin}/enroll#`),
      begun.options.rp.id,
      rows.length,
      rows.every((row) => row.revokedAt === null),
      refused.ok,
      before.length,
      accepted.ok,
    ],
    expected: [true, true, true, https.ceremony.rpId, 2, true, false, 0, true],
  });
});
