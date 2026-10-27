import { requireTestServices } from '@daisy/config';
import { eq } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ABANDON_AFTER_MS,
  reconcileOpenCommands,
} from '../src/features/accounts/commands';
import { operators } from '../src/db/schema';
import { suiteDatabase } from './admin.test-support';
import {
  kinds,
  openCount,
  pending,
  setupCommands,
} from './commands.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { db } = suiteDatabase();

const routes = (stub: { received: readonly { route: string }[] }) =>
  stub.received.map(({ route }) => route);

test('an approval refused for a missing age record settles and is never resent', async () => {
  const { deps, stub, operatorId, approve } = await setupCommands(db, {
    accounts: [{ ...pending(), ageAdmitted: false }],
  });
  const view = await approve();
  const reconciled = await reconcileOpenCommands(deps, operatorId);
  assert({
    given:
      'an approval of an account with no 16+ age record (the participant answers 422 INVARIANT)',
    should:
      'show it refused, settle it, and leave nothing for reconciliation to resend',
    actual: [
      view,
      await kinds(db),
      await openCount(db),
      reconciled,
      routes(stub),
    ],
    expected: [
      { notice: 'refused', mail: null },
      ['command.intent::approved', 'command.outcome:rejected:INVARIANT:'],
      0,
      { settled: 0, open: 0 },
      ['setBetaAccess'],
    ],
  });
});

test('a lost command whose operator is disabled is abandoned only once its PUT can no longer land (ISSUE-708)', async () => {
  const { deps, stub, operatorId, approve, advance } = await setupCommands(db);
  stub.lose('lose-before-apply');
  await approve();
  await db
    .update(operators)
    .set({ disabledAt: new Date('2026-10-26T12:00:00.000Z') })
    .where(eq(operators.id, operatorId));
  const viewer = deps.ids.next();
  await db.insert(operators).values({
    id: viewer,
    displayName: 'second owner',
    role: 'owner',
    createdAt: new Date(deps.clock.now()),
  });
  const inFlight = await reconcileOpenCommands(deps, viewer);
  const openWhileInFlight = await openCount(db);
  advance(ABANDON_AFTER_MS);
  const settled = await reconcileOpenCommands(deps, viewer);
  assert({
    given:
      'a command lost before it arrived, its operator then disabled, and a second owner reconciling inside and then past the skew-plus-timeout window',
    should:
      'read it back as the viewer and never resend; keep it open while its PUT could still land, then close it as abandoned',
    actual: [
      routes(stub),
      stub.received.every(
        ({ route, operatorRef }) =>
          route !== 'readCommand' || operatorRef === viewer,
      ),
      stub.accounts.get(pending().userId)?.accessState,
      inFlight,
      openWhileInFlight,
      settled,
      (await kinds(db)).filter((kind) => kind.includes('abandoned')),
      await openCount(db),
    ],
    expected: [
      ['setBetaAccess', 'readCommand', 'readCommand'],
      true,
      'pending',
      { settled: 0, open: 1 },
      1,
      { settled: 1, open: 0 },
      ['command.reconciled:abandoned:operator_disabled'],
      0,
    ],
  });
});

test('racing reconcilers settle a command exactly once', async () => {
  const { deps, stub, operatorId, approve } = await setupCommands(db);
  stub.lose('lose-after-apply');
  await approve();
  const results = await Promise.all([
    reconcileOpenCommands(deps, operatorId),
    reconcileOpenCommands(deps, operatorId),
  ]);
  const reconciledRows = (await kinds(db)).filter((kind) =>
    kind.startsWith('command.reconciled'),
  );
  assert({
    given: 'a response lost after it applied, then two concurrent reconcilers',
    should:
      'record one reconciliation, close the command once, and count it once',
    actual: [
      reconciledRows,
      await openCount(db),
      results.reduce((sum, { settled }) => sum + settled, 0),
    ],
    expected: [['command.reconciled:changed:mail_queued'], 0, 1],
  });
});

test('an unreachable participant stops the reconciliation batch', async () => {
  let reads = 0;
  let down = false;
  const { deps, stub, operatorId, approve } = await setupCommands(db, {
    wrapFetch: (fetch) => (url, init) => {
      if (!down || !url.includes('/operator/v1/commands/'))
        return fetch(url, init);
      reads += 1;
      return Promise.reject(new TypeError('connection timed out'));
    },
  });
  stub.lose('lose-before-apply');
  stub.lose('lose-before-apply');
  await approve();
  await approve();
  down = true;
  const reconciled = await reconcileOpenCommands(deps, operatorId);
  assert({
    given: 'two open commands and a participant that no longer answers',
    should:
      'stop after the first unanswered read, leaving both open instead of waiting out every call',
    actual: [reads, reconciled, await openCount(db)],
    expected: [1, { settled: 0, open: 2 }, 2],
  });
});
