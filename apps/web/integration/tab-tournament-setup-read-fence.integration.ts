import { createOwnedTournament } from './tab-tournament-owned-event.test-support';
import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore, type TabStore } from '@daisy/db/tab';
import {
  scratchDatabase,
  withRuntimeTestTransaction,
  committingRuntimeTestDatabase,
  finishedOrBlockedBehind,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { setupCommand } from '../src/features/tab/operations/setup';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { organizationStage } from './tab-tournament-organization.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabsetupread');
afterAll(() => scratch.drop());
test('tournament setup projection retains shared reader, metadata and grant fences', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 }),
    reader = new SQL(scratch.url, { max: 1 }),
    writer = new SQL(scratch.url, { max: 1 }),
    observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let reading: Promise<unknown> | null = null;
  let changing: Promise<unknown> | null = null;
  let overlapping: Promise<unknown> | null = null;
  try {
    const bots = await createBots(owner, ['Director', 'Staff', 'Coach']);
    const state = {
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map<string, string>(),
      clock: scriptClock(),
    };
    await withRuntimeTestTransaction(owner, async (frame) => {
      await organizationStage({ ...state, ...frame });
      const owned = await createOwnedTournament({ ...state, ...frame });
      state.made.set('setup-lobby', owned.lobbyId);
    });
    const lobbyId = state.made.get('setup-lobby')!;
    const original = createTabStore(committingRuntimeTestDatabase(reader));
    const read = (store: Pick<TabStore, 'tournamentSetup'>) =>
      readTournamentSetup({ store, authorize, now: state.clock.now })(
        as(state.bots.Staff!),
        lobbyId,
      );
    const pause = () => {
      let reached = () => {};
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const operation = read({
        tournamentSetup: (input, work) =>
          original.tournamentSetup(input, async (facts) => {
            reached();
            await released;
            return work(facts);
          }),
      });
      reading = operation;
      return { ready, operation };
    };
    const [held] = await reader`select pg_backend_pid() as pid`;
    const observed = (operation: Promise<unknown>) =>
      finishedOrBlockedBehind(operation, observer, Number(held?.pid), {
        now: Date.now,
      });
    await pause().ready;
    overlapping = read(createTabStore(committingRuntimeTestDatabase(owner)));
    const concurrent = await observed(overlapping);
    release();
    const [first, second] = await Promise.all([reading, overlapping]);
    assert({
      given: 'two actual Staff setup reads during projection',
      should: 'coexist under shared account and metadata fences',
      actual: [concurrent, first !== null, second !== null],
      expected: ['finished', true, true],
    });
    const creationRead = pause();
    await creationRead.ready;
    changing = setupCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    })(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { lobby: 1 },
      command: {
        type: 'add-event',
        lobbyId,
        name: 'Original event',
        label: 'ONE',
        entry: { kind: 'person' },
        pin: {
          kind: 'format',
          formatId: 'freestyle',
          formatVersion: 1,
          ballotDefinition: null,
        },
      },
    });
    const creationWait = await observed(changing);
    release();
    const empty = await creationRead.operation;
    const created = await changing;
    const afterCreation = await read(original);
    assert({
      given:
        'an actual empty setup projection while its owner creates the first event',
      should:
        'retain zero events through that callback and show the committed event on the next read',
      actual: [
        creationWait,
        empty?.events,
        (created as { kind: string }).kind,
        afterCreation?.events.map((row) => row.name),
      ],
      expected: ['blocked', [], 'accepted', ['Original event']],
    });
    const [event] =
      await owner`select id from events where lobby_id=${lobbyId}`;
    await pause().ready;
    changing = setupCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    })(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { lobby: 2 },
      command: {
        type: 'update-event',
        lobbyId,
        eventId: String(event?.id),
        name: 'Renamed event',
        label: 'TWO',
        ballotDefinition: null,
      },
    });
    const metadata = await observed(changing);
    release();
    await reading;
    const renamed = await changing;
    const fresh = await read(original);
    assert({
      given:
        'the owner changes the event while another authorized host is projecting it',
      should: 'wait and expose the new name on the next committed read',
      actual: [
        metadata,
        (renamed as { kind: string }).kind,
        fresh?.events[0]?.name,
      ],
      expected: ['blocked', 'accepted', 'Renamed event'],
    });
    const organizationId = state.made.get('league')!;
    const [organization] =
      await owner`select version from organizations where id=${organizationId}`;
    const [grant] =
      await owner`select id from grants where organization_id=${organizationId} and user_id=${state.bots.Staff!.userId} and revoked_at is null`;
    await pause().ready;
    changing = organizationCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
      hostingPlan: async () => false,
    })(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { organization: Number(organization?.version) },
      command: {
        type: 'remove-grant',
        grantId: String(grant?.id),
        scope: { kind: 'organization', organizationId: organizationId },
      },
    });
    const grantWait = await observed(changing);
    release();
    const before = await reading;
    const removed = await changing;
    assert({
      given: 'the owner revokes the actual reader grant during projection',
      should: 'retain its fenced authorization and deny the next read',
      actual: [
        grantWait,
        before !== null,
        (removed as { kind: string }).kind,
        await read(original),
      ],
      expected: ['blocked', true, 'accepted', null],
    });
  } finally {
    release();
    await Promise.allSettled([
      ...(reading ? [reading] : []),
      ...(changing ? [changing] : []),
      ...(overlapping ? [overlapping] : []),
    ]);
    await Promise.all([
      owner.close(),
      reader.close(),
      writer.close(),
      observer.close(),
    ]);
  }
});
