import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore, type TabStore } from '@daisy/db/tab';
import {
  finishedOrBlockedBehind,
  scratchDatabase,
  withRuntimeTestTransaction,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { settingCommand } from '../src/features/tab/operations/settings';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type World,
} from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabeventsettings');
afterAll(() => scratch.drop());
type State = Pick<World, 'bots' | 'made' | 'clock'>;
const initialize = async (client: SQL, enter = true): Promise<State> => {
  const bots = await createBots(client, [
    'Director',
    'Staff',
    'Coach',
    'Debater 1',
    'Debater 2',
    'Debater 3',
    'Debater 4',
  ]);
  const state = {
    bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
    made: new Map<string, string>(),
    clock: scriptClock(),
  };
  await withRuntimeTestTransaction(client, async (frame) => {
    const world = { ...state, ...frame };
    await organizationStage(world);
    await leagueAdministrationStage(world);
    await setupStage(world);
    if (enter) await entryEnrollmentStage(world);
  });
  return state;
};

test('real entry requests serialize only with their actual setting parents', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 });
  const writer = new SQL(scratch.url, { max: 1 });
  const entrant = new SQL(scratch.url, { max: 1 });
  const observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let setting: Promise<unknown> | null = null;
  let enrollment: Promise<unknown> | null = null;
  try {
    const a = await initialize(owner);
    const b = await initialize(owner);
    let reached = () => {};
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const [writing] = await writer`select pg_backend_pid() as pid`;
    setting = withRuntimeTestTransaction(writer, ({ database }) => {
      const original = createTabStore(database);
      const held: Pick<TabStore, 'settingCommand'> = {
        settingCommand: (input, work) =>
          original.settingCommand(input, (session) =>
            work({
              ...session,
              load: async () => {
                const loaded = await session.load();
                reached();
                await released;
                return loaded;
              },
            }),
          ),
      };
      return settingCommand({
        store: held,
        authorize,
        now: a.clock.now,
        newId: createId,
      })(as(a.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { settings: 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'organization', id: a.made.get('league')! },
          key: 'room.visibility',
          value: { value: 'unlisted' },
          hold: 'default',
        },
      });
    });
    await ready;
    enrollment = withRuntimeTestTransaction(entrant, ({ database }) =>
      entryEnrollmentCommand({
        store: createTabStore(database),
        authorize,
        now: b.clock.now,
        newId: createId,
      })(as(b.bots.Director!), b.made.get('tournament-lobby')!, {
        version: 1,
        commandId: createId(),
        expected: { entries: Number(b.made.get('entries-version')) },
        command: {
          type: 'set-entry-division',
          entryId: b.made.get('Debater 1')!,
          division: null,
        },
      }),
    );
    const unrelated = await finishedOrBlockedBehind(
      enrollment,
      observer,
      Number(writing!.pid),
      { now: Date.now },
    );
    release();
    const outcomes = await Promise.all([setting, enrollment]);
    const eventId = b.made.get('event')!;
    const [current] =
      await owner`select entries_version, template_id from events where id=${eventId}`;
    await writer.unsafe('begin');
    await writer`select id from templates where id=${String(current!.template_id)} for update`;
    enrollment = withRuntimeTestTransaction(entrant, ({ database }) =>
      entryEnrollmentCommand({
        store: createTabStore(database),
        authorize,
        now: b.clock.now,
        newId: createId,
      })(as(b.bots.Coach!), b.made.get('tournament-lobby')!, {
        version: 1,
        commandId: createId(),
        expected: { entries: Number(current!.entries_version) },
        command: {
          type: 'submit-entry',
          eventId,
          name: 'Fenced adult submission',
          memberActorIds: [b.bots.Coach!.actorId],
          responsible: { kind: 'self' },
          division: null,
        },
      }),
    );
    const parent = await finishedOrBlockedBehind(
      enrollment,
      observer,
      Number(writing!.pid),
      { now: Date.now },
    );
    await writer.unsafe('commit');
    outcomes.push(await enrollment);
    const replacement = await withRuntimeTestTransaction(
      owner,
      ({ database }) =>
        settingCommand({
          store: createTabStore(database),
          authorize,
          now: a.clock.now,
          newId: createId,
        })(as(a.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-template',
            organizationId: a.made.get('league')!,
            name: 'Replacement freestyle',
            format: { id: 'freestyle', version: 1 },
            ballotDefinition: null,
          },
        }),
    );
    if (replacement.kind !== 'accepted')
      throw new Error('Replacement template was refused');
    const c = await initialize(owner, false);
    const cEventId = c.made.get('event')!;
    const [cInitial] =
      await owner`select template_id, settings_version, entries_version from events where id=${cEventId}`;
    let settingsVersion = Number(cInitial!.settings_version);
    for (const [key, value] of [
      ['entry.registration', { state: 'open' }],
      ['entry.approval', { value: 'host' }],
    ] as const) {
      const configured = await withRuntimeTestTransaction(
        owner,
        ({ database }) =>
          settingCommand({
            store: createTabStore(database),
            authorize,
            now: c.clock.now,
            newId: createId,
          })(as(c.bots.Director!), {
            version: 1,
            commandId: createId(),
            expected: { settings: settingsVersion },
            command: {
              type: 'set-setting',
              scope: { kind: 'event', id: cEventId },
              key,
              value,
              hold: 'default',
            },
          }),
      );
      if (configured.kind !== 'accepted')
        throw new Error('Empty event registration setting refused');
      settingsVersion = configured.receipt.resultingVersion;
    }
    await writer.unsafe('begin');
    await writer`select id from templates where id=${String(cInitial!.template_id)} for update`;
    const submitAfterWait = {
      version: 1,
      commandId: createId(),
      expected: { entries: Number(cInitial!.entries_version) },
      command: {
        type: 'submit-entry',
        eventId: cEventId,
        name: 'Changed parent submission',
        memberActorIds: [c.bots.Coach!.actorId],
        responsible: { kind: 'self' },
        division: null,
      },
    };
    enrollment = withRuntimeTestTransaction(entrant, ({ database }) =>
      entryEnrollmentCommand({
        store: createTabStore(database),
        authorize,
        now: c.clock.now,
        newId: createId,
      })(as(c.bots.Coach!), c.made.get('tournament-lobby')!, submitAfterWait),
    );
    const waitingOnOldParent = await finishedOrBlockedBehind(
      enrollment,
      observer,
      Number(writing!.pid),
      { now: Date.now },
    );
    const [beforeUnfollow] =
      await owner`select version, entries_version, settings_version from events where id=${cEventId}`;
    const stopped = await withRuntimeTestTransaction(owner, ({ database }) =>
      settingCommand({
        store: createTabStore(database),
        authorize,
        now: c.clock.now,
        newId: createId,
      })(as(c.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: {
          event: Number(beforeUnfollow!.version),
          entries: Number(beforeUnfollow!.entries_version),
          settings: Number(beforeUnfollow!.settings_version),
        },
        command: { type: 'stop-following-template', eventId: cEventId },
      }),
    );
    if (stopped.kind !== 'accepted')
      throw new Error(
        `Stopping the empty event's follow was refused: ${JSON.stringify(stopped)}`,
      );
    const [beforeFollow] =
      await owner`select version, entries_version, settings_version from events where id=${cEventId}`;
    const followed = await withRuntimeTestTransaction(owner, ({ database }) =>
      settingCommand({
        store: createTabStore(database),
        authorize,
        now: c.clock.now,
        newId: createId,
      })(as(c.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: {
          event: Number(beforeFollow!.version),
          entries: Number(beforeFollow!.entries_version),
          settings: Number(beforeFollow!.settings_version),
        },
        command: {
          type: 'follow-template',
          eventId: cEventId,
          templateId: replacement.receipt.aggregate.id,
        },
      }),
    );
    if (followed.kind !== 'accepted')
      throw new Error(
        `Changing the empty event's template was refused: ${JSON.stringify(followed)}`,
      );
    await writer.unsafe('commit');
    const stale = await enrollment;
    const [beforeRetry] =
      await owner`select count(*)::int as count from entries where event_id=${cEventId}`;
    const retried = await withRuntimeTestTransaction(entrant, ({ database }) =>
      entryEnrollmentCommand({
        store: createTabStore(database),
        authorize,
        now: c.clock.now,
        newId: createId,
      })(as(c.bots.Coach!), c.made.get('tournament-lobby')!, submitAfterWait),
    );
    assert({
      given:
        'actual stop/follow commands changing the event while its first submission waits',
      should:
        'refuse the obsolete chain without a write, then allow a fresh retry',
      actual: [waitingOnOldParent, stale, beforeRetry?.count, retried.kind],
      expected: [
        'blocked',
        { kind: 'refused', refusal: 'version-conflict' },
        0,
        'accepted',
      ],
    });
    assert({
      given:
        'an unrelated organization settings writer, then a writer on the actual followed template',
      should: 'let the unrelated request finish and wait for the real parent',
      actual: [unrelated, parent],
      expected: ['finished', 'blocked'],
    });
    assert({
      given: 'the three real application commands after their fences release',
      should: 'commit exactly their accepted effects',
      actual: outcomes.map((answer) => (answer as { kind: string }).kind),
      expected: ['accepted', 'accepted', 'accepted'],
    });
    const [stored] =
      await owner`select status from entries where event_id=${eventId} and name='Fenced adult submission'`;
    assert({
      given: 'the restarted connection reading the committed submission',
      should: 'retain its host-approval pending state',
      actual: stored?.status,
      expected: 'pending',
    });
  } finally {
    release();
    await writer.unsafe('rollback');
    await Promise.allSettled([
      ...(setting ? [setting] : []),
      ...(enrollment ? [enrollment] : []),
    ]);
    await Promise.all([
      owner.close(),
      writer.close(),
      entrant.close(),
      observer.close(),
    ]);
  }
}, 60_000);
