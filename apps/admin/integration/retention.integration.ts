import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finishSignIn } from '../src/auth/sign-in';
import { sweepExpired } from '../src/db/retention';
import {
  authAttempts,
  operatorChallenges,
  operatorCredentials,
  operatorEnrollments,
  operatorSessions,
} from '../src/db/schema';
import {
  address,
  assertion,
  enrolledOwner,
  suiteDatabase,
  testDeps,
} from './admin.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const counts = async () => [
  (await db.select().from(operatorChallenges)).length,
  (await db.select().from(operatorEnrollments)).length,
  (await db.select().from(operatorSessions)).length,
  (await db.select().from(authAttempts)).length,
  (await db.select().from(operatorCredentials)).length,
];

test('the retention sweep', async () => {
  const deps = testDeps(db);
  const device = await enrolledOwner(deps, 31);
  await finishSignIn(deps, {
    address,
    presented: null,
    response: await assertion(deps, device, 1),
  });
  await finishSignIn(deps, {
    address,
    presented: null,
    response: await device.assert('bogus-challenge', deps.ceremony, 2),
  });
  const before = await counts();
  const early = await sweepExpired(db, '2026-10-30T12:00:00.000Z');
  const late = await sweepExpired(db, '2026-11-04T12:00:01.000Z');
  assert({
    given: 'expired secrets and attempts, swept early and then a week later',
    should:
      'drop attempts after a day and secrets 7 days past expiry, keeping the credential',
    actual: [before, early, late, await counts()],
    expected: [[2, 1, 1, 1, 1], 1, 4, [0, 0, 0, 0, 1]],
  });
});
