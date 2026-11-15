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
import { settingCommand } from '../src/features/tab/operations/settings';
import { readTournamentEventSettings } from '../src/features/tab/reads/tournament-event-settings';
import { organizationStage } from './tab-tournament-organization.test-support';
import { createOwnedEvent } from './tab-tournament-owned-event.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { setupPairingEnvelope } from '../src/features/tab/setup-pairing-form';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabeventread');
afterAll(() => scratch.drop());
test('resolved event readers coexist and retain the actual setting snapshot through projection', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 }),
    reader = new SQL(scratch.url, { max: 1 }),
    writer = new SQL(scratch.url, { max: 1 }),
    observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let reading: ReturnType<
    ReturnType<typeof readTournamentEventSettings>
  > | null = null;
  let overlapping: ReturnType<
    ReturnType<typeof readTournamentEventSettings>
  > | null = null;
  let changing: ReturnType<ReturnType<typeof settingCommand>> | null = null;
  try {
    const bots = await createBots(owner, ['Director', 'Staff', 'Coach']);
    const state = {
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map<string, string>(),
      clock: scriptClock(),
    };
    const owned = await withRuntimeTestTransaction(owner, async (frame) => {
      const world = { ...state, ...frame };
      await organizationStage(world);
      return createOwnedEvent(world);
    });
    const original = createTabStore(committingRuntimeTestDatabase(reader));
    const read = (store: Pick<TabStore, 'tournamentEventSettings'>) =>
      readTournamentEventSettings({ store, authorize, now: state.clock.now })(
        as(state.bots.Staff!),
        owned,
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
        tournamentEventSettings: (input, work) =>
          original.tournamentEventSettings(input, async (facts) => {
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
    const initial = pause();
    await initial.ready;
    overlapping = read(createTabStore(committingRuntimeTestDatabase(owner)));
    const concurrent = await observed(overlapping);
    release();
    const [first, second] = await Promise.all([initial.operation, overlapping]);
    assert({
      given: 'two actual Staff event-settings reads during projection',
      should: 'share the canonical account and actual event-chain fences',
      actual: [concurrent, first !== null, second !== null],
      expected: ['finished', true, true],
    });
    const heldRead = pause();
    await heldRead.ready;
    changing = settingCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    })(as(state.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { settings: 1 },
      command: {
        type: 'set-setting',
        scope: { kind: 'event', id: owned.eventId },
        key: 'entry.cap',
        value: { perEvent: 50, perSchool: null },
        hold: 'default',
      },
    });
    const wait = await observed(changing);
    release();
    const before = await heldRead.operation;
    const written = await changing;
    const after = await read(original);
    assert({
      given:
        'a real persisted event cap changing while its authorized projection is paused',
      should:
        'hold the writer, retain the old projection and expose the new value on a fresh read',
      actual: [
        wait,
        before?.settings.find((row) => row.key === 'entry.cap')?.value,
        before && 'settingsVersion' in before ? before.settingsVersion : null,
        written?.kind,
        after?.settings.find((row) => row.key === 'entry.cap')?.value,
        after && 'settingsVersion' in after ? after.settingsVersion : null,
      ],
      expected: [
        'blocked',
        { perEvent: null, perSchool: null },
        1,
        'accepted',
        { perEvent: 50, perSchool: null },
        2,
      ],
    });
    if (!before) throw new Error('Expected the original setup snapshot');
    const form = new FormData();
    form.set('pairing-preset', 'Random');
    const stale = await settingCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    })(
      as(state.bots.Director!),
      setupPairingEnvelope(
        {
          eventId: owned.eventId,
          settingsVersion: before.settingsVersion,
          commandId: createId(),
          handle: 'stored-tournament',
        },
        form,
      ),
    );
    assert({
      given:
        'the live pairing form bound to the displayed snapshot before another setting changed',
      should:
        'refuse the obsolete guard instead of refreshing it on submission',
      actual: stale,
      expected: { kind: 'refused', refusal: 'version-conflict' },
    });
    if (!after) throw new Error('Expected the reloaded setup snapshot');
    const command = setupPairingEnvelope(
      {
        eventId: owned.eventId,
        settingsVersion: after.settingsVersion,
        commandId: createId(),
        handle: 'stored-tournament',
      },
      form,
    );
    const save = settingCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: state.clock.now,
      newId: createId,
    });
    const saved = await save(as(state.bots.Director!), command);
    const replay = await save(as(state.bots.Director!), command);
    const reloaded = await read(original);
    assert({
      given:
        'a fresh live pairing form and a retry after its answer might have been lost',
      should:
        'save the chosen preset once and recover the original receipt with no second settings revision',
      actual: [
        saved.kind,
        replay.kind === 'accepted' ? replay.receipt.replayed : false,
        reloaded?.settingsVersion,
        reloaded?.settings.find((row) => row.key === 'pairing.preset')?.value,
      ],
      expected: ['accepted', true, 3, { value: 'random' }],
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
