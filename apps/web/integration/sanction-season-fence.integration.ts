import { hostWaits } from '@daisy/worker/host';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import {
  scratchDatabase,
  withRuntimeTestTransaction,
  committingRuntimeTestDatabase,
  finishedOrBlockedBehind,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sanctionCommand } from '../src/features/tab/operations/sanction-command';
import { readLeagueSeason } from '../src/features/tab/reads/league-season';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import {
  sanctionRegressionFixture,
  sanctionRegressionNames,
} from './sanction-regression.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const databaseCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  if ('errno' in error && typeof error.errno === 'string') return error.errno;
  return 'cause' in error ? databaseCode(error.cause) : null;
};
test('a separate-account season reader and league withdrawal retain canonical parent-before-sanction fences', async () => {
  const scratch = scratchDatabase(databaseUrl, 'sanctionseasonfence');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 1 }),
    gate = new SQL(scratch.url, { max: 1 }),
    writer = new SQL(scratch.url, { max: 1 }),
    reader = new SQL(scratch.url, { max: 1 }),
    observer = new SQL(scratch.url, { max: 1 });
  let releaseGate = () => {};
  let holding: Promise<unknown> | null = null,
    withdrawing: ReturnType<ReturnType<typeof sanctionCommand>> | null = null,
    reading: ReturnType<ReturnType<typeof readLeagueSeason>> | null = null;
  try {
    await scratch.migrate(() => true);
    const bots = await createBots(owner, sanctionRegressionNames);
    const state = {
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      clock: scriptClock(Date.now()),
      made: new Map<string, string>(),
    };
    const fixture = await withRuntimeTestTransaction(owner, (frame) =>
      sanctionRegressionFixture({ ...state, ...frame }),
    );
    const [gateBackend] = await gate`select pg_backend_pid() as pid`,
      [writerBackend] = await writer`select pg_backend_pid() as pid`;
    let announceGate = () => {};
    const ready = new Promise<void>((resolve) => {
      announceGate = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    holding = gate.begin(async (tx) => {
      // The gate holds only the child event, so the real withdrawal can acquire its canonical lobby lock first.
      await tx`select id from events where id=${fixture.eventId} for share`;
      announceGate();
      await held;
    });
    await ready;
    withdrawing = sanctionCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      newId: createId,
    })(as(fixture.director), fixture.input, fixture.withdrawal);
    const writerWait = await finishedOrBlockedBehind(
      withdrawing,
      observer,
      Number(gateBackend!.pid),
      { waits: hostWaits },
    );
    reading = readLeagueSeason({
      store: createTabStore(committingRuntimeTestDatabase(reader)),
      authorize,
    })(as(fixture.reader), {
      organizationId: fixture.organizationId,
      seasonId: fixture.seasonId,
      templateId: fixture.templateId,
    });
    const readerWait = await finishedOrBlockedBehind(
      reading,
      observer,
      Number(writerBackend!.pid),
      { waits: hostWaits },
    );
    releaseGate();
    await holding;
    const [written, read] = await Promise.allSettled([withdrawing, reading]);
    assert({
      given:
        'an actual league director withdrawal holding its lobby fence and blocked at the gated event, then an independent league-member season read blocked behind that lobby',
      should:
        'complete both real transactions after the event gate opens without a sanction/lobby lock cycle',
      actual: [
        writerWait,
        readerWait,
        written.status,
        read.status,
        written.status === 'fulfilled' ? written.value.kind : null,
        [written, read].flatMap((outcome) =>
          outcome.status === 'rejected' ? [databaseCode(outcome.reason)] : [],
        ),
      ],
      expected: [
        'blocked',
        'blocked',
        'fulfilled',
        'fulfilled',
        'accepted',
        [],
      ],
    });
    assert({
      given:
        'the withdrawal committed before the season reader acquires the event parent fence',
      should:
        'revalidate approval under that fence and receive no withdrawn event standings',
      actual:
        read.status === 'fulfilled' ? read.value?.view.standings.rows : null,
      expected: [],
    });
    assert({
      given: 'the post-fence calendar of the same concurrent season read',
      should: 'show the committed withdrawal rather than a stale approval',
      actual:
        read.status === 'fulfilled'
          ? read.value?.view.calendar.find(
              (event) => event.lobbyId === fixture.lobbyId,
            )?.sanction
          : null,
      expected: 'withdrawn',
    });
    const [sanction] =
      await owner`select status,version from sanctions where id=${fixture.sanctionId}`;
    const history =
      await owner`select command_id from action_history where command_id=${fixture.withdrawal.commandId}`;
    assert({
      given: 'the canonical league-side withdrawal after contention',
      should: 'commit one explicit transition and one journal entry',
      actual: [sanction, history.length],
      expected: [{ status: 'withdrawn', version: 3 }, 1],
    });
  } finally {
    releaseGate();
    await Promise.allSettled([
      ...(holding ? [holding] : []),
      ...(withdrawing ? [withdrawing] : []),
      ...(reading ? [reading] : []),
    ]);
    await Promise.all([
      owner.close(),
      gate.close(),
      writer.close(),
      reader.close(),
      observer.close(),
    ]);
    await scratch.drop();
  }
}, 60000);
