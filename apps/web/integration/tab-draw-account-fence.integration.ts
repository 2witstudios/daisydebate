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
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabdrawfence');
afterAll(() => scratch.drop());
test('draw requests fence the actual cast and refuse a roster discovered after an account wait', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 });
  const drawer = new SQL(scratch.url, { max: 1 });
  const judge = new SQL(scratch.url, { max: 1 });
  const observer = new SQL(scratch.url, { max: 1 });
  let release = () => {};
  let fence: Promise<unknown> | null = null;
  let drawing: Promise<unknown> | null = null;
  let answering: Promise<unknown> | null = null;
  try {
    const bots = await createBots(owner, [
      'Director',
      'Staff',
      'Coach',
      'Judge A',
      'Judge B',
      'Judge C',
      'Debater 1',
      'Debater 2',
      'Debater 3',
      'Debater 4',
    ]);
    const state = {
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      clock: scriptClock(),
      made: new Map<string, string>(),
    };
    await withRuntimeTestTransaction(owner, async (frame) => {
      const world = { ...state, ...frame };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      await setupStage(world);
      await entryEnrollmentStage(world);
      await judgeRegistrationStage(world);
      const invite = await judgeRegistrationCommand({
        store: createTabStore(frame.database),
        authorize,
        now: state.clock.now,
        newId: createId,
        minorsReleased: async () => false,
      })(as(state.bots.Director!), state.made.get('tournament-lobby')!, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'invite-judge',
          actorId: state.bots['Judge B']!.actorId,
          schoolOrganizationId: null,
          chairQualified: true,
          eventIds: [state.made.get('event')!],
        },
      });
      if (invite.kind !== 'accepted')
        throw new Error('pending judge setup failed');
    });
    const lobbyId = state.made.get('tournament-lobby')!;
    const [event] =
      await owner`select entries_version,settings_version from events where id=${state.made.get('event')!}`;
    const generate = {
      version: 1,
      commandId: createId(),
      expected: {
        results: 1,
        entries: Number(event?.entries_version),
        settings: Number(event?.settings_version),
      },
      command: {
        type: 'generate-draw',
        tabRoundId: state.made.get('tab-round')!,
        resultCutoff: 0,
        seed: 'ab'.repeat(32),
      },
    };
    const draw = (
      database: Parameters<typeof createTabStore>[0],
      body: unknown,
    ) =>
      drawCommand({
        store: createTabStore(database),
        authorize,
        now: state.clock.now,
        newId: createId,
        competition: firstDrawCompetition,
      })(as(state.bots.Director!), lobbyId, body);
    let reached = () => {};
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const [holding] = await owner`select pg_backend_pid() as pid`;
    fence = owner.begin(async (sql) => {
      await sql`select * from public.daisy_authorization_accounts_v2(array[${state.bots['Debater 1']!.actorId}]::text[],null::text,true)`;
      reached();
      await released;
    });
    await ready;
    drawing = withRuntimeTestTransaction(drawer, ({ database }) =>
      draw(database, generate),
    );
    const blocked = await finishedOrBlockedBehind(
      drawing,
      observer,
      Number(holding?.pid),
      { now: Date.now },
    );
    const [pending] =
      await judge`select id from tournament_judges where lobby_id=${lobbyId} and actor_id=${state.bots['Judge B']!.actorId}`;
    const accepted = await withRuntimeTestTransaction(judge, ({ database }) =>
      judgeRegistrationCommand({
        store: createTabStore(database),
        authorize,
        now: state.clock.now,
        newId: createId,
        minorsReleased: async () => false,
      })(as(state.bots['Judge B']!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'accept-judge-invitation',
          tournamentJudgeId: String(pending?.id),
        },
      }),
    );
    release();
    await fence;
    const stale = await drawing;
    const [unchanged] =
      await owner`select count(*)::int as count from draws where lobby_id=${lobbyId}`;
    assert({
      given:
        'an actual judge accepting while generation waits on an earlier accepted entrant account',
      should: 'refuse the now-unfenced cast before any draft is stored',
      actual: [blocked, accepted.kind, stale, unchanged?.count],
      expected: [
        'blocked',
        'accepted',
        { kind: 'refused', refusal: 'version-conflict' },
        0,
      ],
    });
    const retry = await withRuntimeTestTransaction(drawer, ({ database }) =>
      draw(database, generate),
    );
    assert({
      given:
        'the same unrecorded request retried with all current cast accounts fenced',
      should: 'persist its first real draft',
      actual: retry.kind,
      expected: 'accepted',
    });
    let loaded = () => {};
    const loadedReady = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    const afterLoad = new Promise<void>((resolve) => {
      release = resolve;
    });
    const [writing] = await drawer`select pg_backend_pid() as pid`;
    drawing = withRuntimeTestTransaction(drawer, ({ database }) => {
      const original = createTabStore(database);
      const held: Pick<TabStore, 'drawCommand'> = {
        drawCommand: (input, work) =>
          original.drawCommand(input, (session) =>
            work({
              ...session,
              load: async () => {
                const facts = await session.load();
                loaded();
                await afterLoad;
                return facts;
              },
            }),
          ),
      };
      return drawCommand({
        store: held,
        authorize,
        now: state.clock.now,
        newId: createId,
        competition: firstDrawCompetition,
      })(as(state.bots.Director!), lobbyId, {
        ...generate,
        commandId: createId(),
        expected: { ...generate.expected, draw: 1 },
        command: { ...generate.command, seed: 'cd'.repeat(32) },
      });
    });
    await loadedReady;
    answering = withRuntimeTestTransaction(judge, ({ database }) =>
      judgeRegistrationCommand({
        store: createTabStore(database),
        authorize,
        now: state.clock.now,
        newId: createId,
        minorsReleased: async () => false,
      })(as(state.bots['Judge A']!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'set-judge-availability',
          tournamentJudgeId: state.made.get('judge-a')!,
          availability: [
            { timeSlotId: state.made.get('time-slot')!, available: false },
          ],
        },
      }),
    );
    const heldAccount = await finishedOrBlockedBehind(
      answering,
      observer,
      Number(writing?.pid),
      { now: Date.now },
    );
    release();
    const outcomes = await Promise.all([drawing, answering]);
    const [committed] =
      await owner`select count(*)::int as count from draws where lobby_id=${lobbyId}`;
    assert({
      given:
        'generation holding its loaded named-judge fence while that judge changes availability',
      should:
        'serialize the actual account mutation and retain both committed drafts',
      actual: [
        heldAccount,
        outcomes.map((answer) => (answer as { kind: string }).kind),
        committed?.count,
      ],
      expected: ['blocked', ['accepted', 'accepted'], 2],
    });
  } finally {
    release();
    await Promise.allSettled([
      ...(fence ? [fence] : []),
      ...(drawing ? [drawing] : []),
      ...(answering ? [answering] : []),
    ]);
    await Promise.all([
      owner.close(),
      drawer.close(),
      judge.close(),
      observer.close(),
    ]);
  }
}, 60_000);
