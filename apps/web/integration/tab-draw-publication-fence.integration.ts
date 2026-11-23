import { hostWaits } from '@daisy/worker/host';
import { seedPaidHosting } from './hosting-purchase.test-support';
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
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { settingCommand } from '../src/features/tab/operations/settings';
import { preparePublication } from './tab-publication-setup.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const scratch = scratchDatabase(databaseUrl, 'tabpublishfence');
afterAll(() => scratch.drop());
test('publication reloads after account waits and holds actual Room pins through commit', async () => {
  await scratch.create();
  await scratch.migrate(() => true);
  const owner = new SQL(scratch.url, { max: 1 }),
    publisher = new SQL(scratch.url, { max: 1 }),
    writer = new SQL(scratch.url, { max: 1 }),
    observer = new SQL(scratch.url, { max: 1 });
  let releaseAccount = () => {},
    releasePublication = () => {};
  let holding: Promise<unknown> | null = null,
    publishing: ReturnType<ReturnType<typeof drawCommand>> | null = null,
    changing: ReturnType<ReturnType<typeof settingCommand>> | null = null;
  try {
    const prepare = async (template: 'follow' | 'copy' = 'copy') => {
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
        await preparePublication({ ...frame, ...state }, template, async () => {
          const lobbyId = state.made.get('tournament-lobby')!;
          await seedPaidHosting(
            frame.sql,
            lobbyId,
            state.bots.Director!.userId,
          );
          const [settings] =
            await frame.sql`select settings_version from lobbies where id=${lobbyId}`;
          const configured = await settingCommand({
            store: createTabStore(frame.database),
            authorize,
            now: state.clock.now,
            newId: createId,
          })(as(state.bots.Director!), {
            version: 1,
            commandId: createId(),
            expected: { settings: Number(settings!.settings_version) },
            command: {
              type: 'set-setting',
              scope: { kind: 'lobby', id: lobbyId },
              key: 'recording.capture',
              value: { value: 'on' },
              hold: 'default',
            },
          });
          if (configured.kind !== 'accepted')
            throw new Error('Actual officials recording setting refused');
        });
        const [role] =
          await frame.sql`select r.id from roles r join role_permissions p on p.role_id=r.id where r.preset=true and p.permission='lobby.setup.manage' order by r.rank,r.id limit 1`;
        const [lobby] =
          await frame.sql`select version from lobbies where id=${state.made.get('tournament-lobby')!}`;
        if (!role || !lobby)
          throw new Error('The actual setup role or lobby is missing');
        const grant = await organizationCommand({
          store: createTabStore(frame.database),
          authorize,
          now: state.clock.now,
          newId: createId,
        })(as(state.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: { lobby: Number(lobby.version) },
          command: {
            type: 'give-grant',
            scope: {
              kind: 'lobby',
              lobbyId: state.made.get('tournament-lobby')!,
            },
            userId: state.bots.Staff!.userId,
            roleId: String(role.id),
            expiresAt: null,
          },
        });
        if (grant.kind !== 'accepted')
          throw new Error(
            `Independent setup grant refused: ${JSON.stringify(grant)}`,
          );
      });
      return state;
    };
    const store = createTabStore(committingRuntimeTestDatabase(publisher));
    const first = await prepare(),
      lobbyId = first.made.get('tournament-lobby')!,
      eventId = first.made.get('event')!;
    const [slot] =
      await owner`select version from time_slots where id=${first.made.get('time-slot')!}`;
    const [event] =
      await owner`select entries_version,settings_version from events where id=${eventId}`;
    const envelope = {
      version: 1,
      commandId: createId(),
      expected: {
        draw: 1,
        entries: Number(event!.entries_version),
        timeSlot: Number(slot!.version),
      },
      command: {
        type: 'publish-draw',
        drawId: first.made.get('draw')!,
        overrides: [],
      },
    };
    let reachedAccount = () => {};
    const accountReady = new Promise<void>((resolve) => {
        reachedAccount = resolve;
      }),
      accountRelease = new Promise<void>((resolve) => {
        releaseAccount = resolve;
      });
    let holderPid = 0;
    holding = owner.begin(async (tx) => {
      const [backend] = await tx`select pg_backend_pid() as pid`;
      holderPid = Number(backend!.pid);
      await tx`select id from users where id=${first.bots['Debater 1']!.userId} for update`;
      reachedAccount();
      await accountRelease;
    });
    await accountReady;
    const [publisherBackend] = await publisher`select pg_backend_pid() as pid`;
    publishing = drawCommand({
      store,
      authorize,
      now: first.clock.now,
      newId: createId,
      competition: firstDrawCompetition,
    })(as(first.bots.Director!), lobbyId, envelope);
    publishing.catch(() => {});
    const accountWait = await finishedOrBlockedBehind(
      publishing,
      observer,
      holderPid,
      { waits: hostWaits },
    );
    changing = settingCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: first.clock.now,
      newId: createId,
    })(as(first.bots.Staff!), {
      version: 1,
      commandId: createId(),
      expected: { settings: Number(event!.settings_version) },
      command: {
        type: 'set-setting',
        scope: { kind: 'event', id: eventId },
        key: 'entry.cap',
        value: { perEvent: 50, perSchool: null },
        hold: 'default',
      },
    });
    changing.catch(() => {});
    const changedBeforeFence = await finishedOrBlockedBehind(
      changing,
      observer,
      Number(publisherBackend!.pid),
      { waits: hostWaits },
    );
    releaseAccount();
    await holding;
    holding = null;
    const changed = await changing;
    changing = null;
    const refused = await publishing;
    publishing = null;
    const [empty] =
      await owner`select (select count(*)::int from rooms where lobby_id=${lobbyId}) rooms,(select count(*)::int from action_history where command_id=${envelope.commandId}) history`;
    assert({
      given:
        'a real settings writer committing while publication waits on an entrant account',
      should:
        'reload the actual input digest and refuse stale publication without a Room or accepted receipt',
      actual: [
        accountWait,
        changedBeforeFence,
        changed.kind,
        refused,
        empty?.rooms,
        empty?.history,
      ],
      expected: [
        'blocked',
        'finished',
        'accepted',
        { kind: 'refused', refusal: 'inputs-changed' },
        0,
        0,
      ],
    });

    const second = await prepare(),
      nextLobby = second.made.get('tournament-lobby')!;
    const [nextSlot] =
      await owner`select version from time_slots where id=${second.made.get('time-slot')!}`;
    const [nextEvent] =
      await owner`select entries_version from events where id=${second.made.get('event')!}`;
    const [nextParent] =
      await owner`select settings_version from lobbies where id=${nextLobby}`;
    const [backend] = await publisher`select pg_backend_pid() as pid`;
    let reachedPublication = () => {};
    const publicationReady = new Promise<void>((resolve) => {
        reachedPublication = resolve;
      }),
      publicationRelease = new Promise<void>((resolve) => {
        releasePublication = resolve;
      });
    const heldStore: Pick<TabStore, 'drawCommand'> = {
      drawCommand: (input, work) =>
        store.drawCommand(input, (session) =>
          work({
            ...session,
            load: async () => {
              const facts = await session.load();
              reachedPublication();
              await publicationRelease;
              return facts;
            },
          }),
        ),
    };
    publishing = drawCommand({
      store: heldStore,
      authorize,
      now: second.clock.now,
      newId: createId,
      competition: firstDrawCompetition,
    })(as(second.bots.Director!), nextLobby, {
      version: 1,
      commandId: createId(),
      expected: {
        draw: 1,
        entries: Number(nextEvent!.entries_version),
        timeSlot: Number(nextSlot!.version),
      },
      command: {
        type: 'publish-draw',
        drawId: second.made.get('draw')!,
        overrides: [],
      },
    });
    publishing.catch(() => {});
    await publicationReady;
    changing = settingCommand({
      store: createTabStore(committingRuntimeTestDatabase(writer)),
      authorize,
      now: second.clock.now,
      newId: createId,
    })(as(second.bots.Staff!), {
      version: 1,
      commandId: createId(),
      expected: { settings: Number(nextParent!.settings_version) },
      command: {
        type: 'set-setting',
        scope: { kind: 'lobby', id: nextLobby },
        key: 'recording.capture',
        value: { value: 'off' },
        hold: 'default',
      },
    });
    changing.catch(() => {});
    const metadataWait = await finishedOrBlockedBehind(
      changing,
      observer,
      Number(backend!.pid),
      { waits: hostWaits },
    );
    releasePublication();
    const [published, written] = await Promise.all([publishing, changing]);
    publishing = null;
    changing = null;
    const rooms = await owner<
      { policy: string }[]
    >`select capture->>'recordingPolicy' policy from rooms where lobby_id=${nextLobby}`;
    const [receipt] =
      await owner`select count(*)::int count from action_history where lobby_id=${nextLobby} and type='publish-draw'`;
    assert({
      given:
        'a recording writer on another account while actual publication holds its projection and Room pins',
      should:
        'wait until Room assembly and receipt commit, preserving the original recording pin on every Room',
      actual: [
        metadataWait,
        published.kind,
        written.kind,
        rooms.length,
        rooms.every((room) => room.policy === 'officials'),
        receipt?.count,
      ],
      expected: ['blocked', 'accepted', 'accepted', 2, true, 1],
    });

    const third = await prepare(),
      lastLobby = third.made.get('tournament-lobby')!,
      lastRound = third.made.get('tab-round')!;
    const [lastSlot] =
      await owner`select version from time_slots where id=${third.made.get('time-slot')!}`;
    const [lastEvent] =
      await owner`select entries_version from events where id=${third.made.get('event')!}`;
    const [beforeFault] =
      await owner`select version,resolution_released_at from tab_rounds where id=${lastRound}`;
    const retryEnvelope = {
      version: 1,
      commandId: createId(),
      expected: {
        draw: 1,
        entries: Number(lastEvent!.entries_version),
        timeSlot: Number(lastSlot!.version),
      },
      command: {
        type: 'publish-draw',
        drawId: third.made.get('draw')!,
        overrides: [],
      },
    };
    const failure = new Error('Injected second Room cast failure');
    const faultStore: Pick<TabStore, 'drawCommand'> = {
      drawCommand: (input, work) =>
        store.drawCommand(input, (session) =>
          work({
            ...session,
            apply: (writes, history, receipt, assembly) =>
              session.apply(writes, history, receipt, {
                ...assembly,
                rooms: assembly.rooms.map((room, index) =>
                  index === 1 && room.cast
                    ? {
                        ...room,
                        cast: {
                          ...room.cast,
                          apply: () => {
                            throw failure;
                          },
                        },
                      }
                    : room,
                ),
              }),
          }),
        ),
    };
    let failed = false;
    try {
      await drawCommand({
        store: faultStore,
        authorize,
        now: third.clock.now,
        newId: createId,
        competition: firstDrawCompetition,
      })(as(third.bots.Director!), lastLobby, retryEnvelope);
    } catch (error) {
      failed = error === failure;
    }
    const [rolledBack] =
      await owner`select (select count(*)::int from rooms where lobby_id=${lastLobby}) rooms,(select count(*)::int from releases where lobby_id=${lastLobby}) releases,(select count(*)::int from action_history where command_id=${retryEnvelope.commandId}) history,(select count(*)::int from active_seats where actor_id in (${third.bots['Debater 1']!.actorId},${third.bots['Debater 2']!.actorId},${third.bots['Debater 3']!.actorId},${third.bots['Debater 4']!.actorId},${third.bots['Judge A']!.actorId},${third.bots['Judge B']!.actorId})) seats`;
    const [afterFault] =
      await owner`select version,resolution_released_at from tab_rounds where id=${lastRound}`;
    assert({
      given:
        'a real second Room cast fault after the journal, wording pin and first Room writes have run',
      should:
        'roll back every Room, active seat, release, receipt and wording-release revision together',
      actual: [
        failed,
        rolledBack?.rooms,
        rolledBack?.releases,
        rolledBack?.history,
        rolledBack?.seats,
        afterFault?.version === beforeFault?.version,
        afterFault?.resolution_released_at,
      ],
      expected: [true, 0, 0, 0, 0, true, null],
    });
    const retry = drawCommand({
      store,
      authorize,
      now: third.clock.now,
      newId: createId,
      competition: firstDrawCompetition,
    });
    const restored = await retry(
        as(third.bots.Director!),
        lastLobby,
        retryEnvelope,
      ),
      replayed = await retry(
        as(third.bots.Director!),
        lastLobby,
        retryEnvelope,
      );
    const [restoredCounts] =
      await owner`select (select count(*)::int from rooms where lobby_id=${lastLobby}) rooms,(select count(*)::int from action_history where command_id=${retryEnvelope.commandId}) history`;
    assert({
      given: 'the same command retried after the complete failed transaction',
      should: 'publish once and recover its original receipt on the next retry',
      actual: [
        restored.kind,
        replayed.kind === 'accepted' ? replayed.receipt.replayed : false,
        restoredCounts?.rooms,
        restoredCounts?.history,
      ],
      expected: ['accepted', true, 2, 1],
    });

    const fourth = await prepare('follow'),
      privateLobby = fourth.made.get('tournament-lobby')!,
      privateRound = fourth.made.get('tab-round')!;
    const [templateOwner] =
      await owner`select organization_id from templates where id='s3tw1srulgcs6y2xhbog8gps'`;
    if (!templateOwner)
      throw new Error('The actual followed template is missing');
    const privatePool = createId(),
      privateWording = createId();
    // An owner-only poisoned reference tests that following a template never widens pool authority.
    await owner`insert into resolution_pools(id,organization_id,name) values(${privatePool},${templateOwner.organization_id},'Private template-owner pool')`;
    await owner`insert into pool_resolutions(id,pool_id,organization_id,text) values(${privateWording},${privatePool},${templateOwner.organization_id},'Unpublished private wording')`;
    await owner`update tab_rounds set resolution_pool_id=${privatePool},pool_resolution_id=${privateWording} where id=${privateRound}`;
    const [privateSlot] =
      await owner`select version from time_slots where id=${fourth.made.get('time-slot')!}`;
    const [privateEvent] =
      await owner`select entries_version from events where id=${fourth.made.get('event')!}`;
    const privateCommandId = createId();
    const privateResult = await drawCommand({
      store,
      authorize,
      now: fourth.clock.now,
      newId: createId,
      competition: firstDrawCompetition,
    })(as(fourth.bots.Director!), privateLobby, {
      version: 1,
      commandId: privateCommandId,
      expected: {
        draw: 1,
        entries: Number(privateEvent!.entries_version),
        timeSlot: Number(privateSlot!.version),
      },
      command: {
        type: 'publish-draw',
        drawId: fourth.made.get('draw')!,
        overrides: [],
      },
    });
    const [privateCounts] =
      await owner`select (select count(*)::int from rooms where lobby_id=${privateLobby}) rooms,(select count(*)::int from action_history where command_id=${privateCommandId}) history`;
    assert({
      given:
        'a followed public template with an owner-poisoned reference to its organization’s private pool',
      should:
        'refuse that unrelated pool before Room construction, without exposing wording or recording an accepted receipt',
      actual: [privateResult, privateCounts?.rooms, privateCounts?.history],
      expected: [{ kind: 'refused', refusal: 'draw-unresolved' }, 0, 0],
    });
  } finally {
    releaseAccount();
    releasePublication();
    await Promise.allSettled([
      ...(holding ? [holding] : []),
      ...(publishing ? [publishing] : []),
      ...(changing ? [changing] : []),
    ]);
    await Promise.all([
      owner.close(),
      publisher.close(),
      writer.close(),
      observer.close(),
    ]);
  }
}, 60_000);
