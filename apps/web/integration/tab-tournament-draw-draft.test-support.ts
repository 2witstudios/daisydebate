import { authorize } from '@daisy/auth/authorization';
import type { LoadedDrawCommand } from '@daisy/db/tab';
import { createTabStore } from '@daisy/db/tab';
import { noopErrorReporter } from '@daisy/observability';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import {
  hostDrawOverviewSchema,
  hostRoundViewSchema,
} from '@daisy/protocol/lobby/draw-read';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { z } from 'zod';
import { createDrawCommandRoute } from '../src/features/tab/draw-command-route';
import { drawFormEnvelope } from '../src/features/tab/draw-form';
import {
  hostDrawOverviewPath,
  hostRoundPath,
} from '../src/features/tab/host-draw-route';
import type { DrawCompetition } from '../src/features/tab/operations/draw-facts';
import { readHostRound } from '../src/features/tab/reads/host-round';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import {
  hostDrawHttp,
  hostDrawRequest,
} from './tab-tournament-host-draw.test-support';
import {
  as,
  deniedAsNotFound,
  presetStaffRoleId,
} from './tab-tournament-organization-wiring.test-support';
import {
  tabCommand,
  tabLobbyCommand,
  tabRead,
} from './tab-tournament-transport.test-support';
import {
  withClosedTabRelease,
  type World,
} from './tab-tournament.test-support';

export const firstDrawCompetition = (
  loaded: LoadedDrawCommand,
): DrawCompetition => {
  if (
    loaded.results.length ||
    loaded.fixtureResults.length ||
    loaded.stage?.kind !== 'preliminary'
  )
    throw new Error(
      'This first-draw proof requires the observed empty result set and preliminary stage',
    );
  return {
    stage: { kind: 'preliminary' },
    history: { fixtures: [], results: [] },
    ratings: null,
    breakChoicesPending: false,
    feederResultsComplete: true,
    breakResultIds: [],
  };
};

/** The production Draw boundary/operation, with the test's genuinely authenticated actor. */
export const drawHttp = (world: World, released = true) =>
  createDrawCommandRoute({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => ({
        ...member,
        principal: {
          ...as(world.bots.Director!),
          actorId: world.bots.Director!.actorId,
        },
      }),
    },
    released: async () => released,
  });
const drawRequest = (lobbyId: string, envelope: unknown) =>
  new Request(
    `${origin}/api/tab/draw-command?${new URLSearchParams({ lobbyId })}`,
    {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    },
  );
export const acceptedDrawResponse = async (response: Response) => {
  if (response.status !== 200)
    throw new Error(`Draw HTTP status ${response.status}`);
  return z
    .strictObject({
      kind: z.literal('accepted'),
      receipt: lobbyCommandReceiptSchema,
    })
    .parse(await response.json());
};

export const draftDrawStage = async (world: World): Promise<void> => {
  const { database, sql } = world;
  const store = createTabStore(database);
  const send = tabLobbyCommand(world, 'draw');
  const lobbyId = world.made.get('tournament-lobby')!;
  const roundId = world.made.get('tab-round')!;
  const eventId = world.made.get('event')!;
  const [event] =
    await sql`select entries_version, settings_version from events where id=${eventId}`;
  const address = { lobbyId, eventId, tabRoundId: roundId };
  const director = world.bots.Director!;
  const http = world.http;
  const direct = hostDrawHttp(world, director);
  const undrawnResponse = http
    ? await http(director, hostRoundPath(address))
    : await direct.round(hostDrawRequest(hostRoundPath(address)));
  const undrawn = hostRoundViewSchema.parse(await undrawnResponse.json());
  const overviewResponse = http
    ? await http(director, hostDrawOverviewPath(lobbyId))
    : await direct.overview(hostDrawRequest(hostDrawOverviewPath(lobbyId)));
  const overview = hostDrawOverviewSchema.parse(await overviewResponse.json());
  assert({
    given: 'the actual host Draw HTTP reads before the first draft',
    should:
      'return no-store current source guards, null absent draw and the real scheduled Round',
    actual: [
      undrawn.kind,
      undrawn.guards.draw,
      undrawnResponse.headers.get('cache-control'),
      overview.events
        .find((row) => row.eventId === eventId)
        ?.rounds.some((row) => row.tabRoundId === roundId && row.draw === null),
      (http
        ? await http(world.bots['Debater 1']!, hostRoundPath(address))
        : await hostDrawHttp(world, world.bots['Debater 1']!).round(
            hostDrawRequest(hostRoundPath(address)),
          )
      ).status,
    ],
    expected: ['undrawn', null, 'no-store', true, 404],
  });
  const target = {
    version: 1,
    commandId: createId(),
    expected: {
      results: 1,
      entries: Number(event?.entries_version),
      settings: Number(event?.settings_version),
    },
    command: {
      type: 'generate-draw',
      tabRoundId: roundId,
      resultCutoff: 0,
      seed: 'ab'.repeat(32),
    },
  };
  const form = new FormData();
  form.set('commandId', createId());
  form.set('tabRoundId', createId());
  const generate = drawFormEnvelope(
    {
      handle: 'tournament',
      lobbyId,
      eventId,
      tabRoundId: roundId,
      overrideKeys: [],
      envelope: {
        ...target,
        version: 1,
        expected: {
          entries: undrawn.guards.entries,
          settings: undrawn.guards.settings,
          results: undrawn.guards.results,
        },
        command: { ...target.command, type: 'generate-draw' },
      },
    },
    form,
  );

  assert({
    given: 'an entrant asking to draw the tournament',
    should: 'deny the operation without host authority',
    actual: await deniedAsNotFound(() =>
      send(as(world.bots['Debater 1']!), lobbyId, generate),
    ),
    expected: true,
  });
  assert({
    given:
      'a stale entries guard and an actual target belonging to another lobby',
    should:
      'refuse the stale request and hide the foreign round before any draw is written',
    actual: [
      await send(as(world.bots.Director!), lobbyId, {
        ...generate,
        commandId: createId(),
        expected: {
          ...generate.expected,
          entries: undrawn.guards.entries - 1,
        },
      }),
      await deniedAsNotFound(() =>
        send(
          as(world.bots.Director!),
          world.made.get('standing-lobby')!,
          generate,
        ),
      ),
      (await sql`select id from draws where tab_round_id=${roundId}`).length,
    ],
    expected: [{ kind: 'refused', refusal: 'version-conflict' }, true, 0],
  });
  const generationRequest = () => drawRequest(lobbyId, generate);
  const generationPath = `/api/tab/draw-command?${new URLSearchParams({ lobbyId })}`;
  const closed = http
    ? await withClosedTabRelease(world, async () => [
        (await http(director, hostRoundPath(address))).status,
        (await http(director, generationPath, generate)).status,
      ])
    : [
        (
          await hostDrawHttp(world, director, false).round(
            hostDrawRequest(hostRoundPath(address)),
          )
        ).status,
        (await drawHttp(world, false)(generationRequest())).status,
      ];
  assert({
    given: 'a signed-in host while Tab release is closed',
    should: 'hide the round and refuse generation without writing a draft',
    actual: [
      ...closed,
      (await sql`select id from draws where tab_round_id=${roundId}`).length,
    ],
    expected: [404, 404, 0],
  });
  const generationResponse = http
    ? await http(director, generationPath, generate)
    : await drawHttp(world)(generationRequest());
  const generated = await acceptedDrawResponse(generationResponse);
  assert({
    given: 'the real current owner at the production Draw HTTP boundary',
    should: 'generate the genuine draft with no-store response policy',
    actual: [
      generationResponse.status,
      generationResponse.headers.get('cache-control'),
    ],
    expected: [200, 'no-store'],
  });
  assert({
    given: 'the real owner and accepted entries',
    should: 'persist a computed draft and replay its exact receipt',
    actual: [
      generated.kind,
      await send(as(world.bots.Director!), lobbyId, generate),
    ],
    expected: [
      'accepted',
      generated.kind === 'accepted'
        ? {
            ...generated,
            receipt: { ...generated.receipt, replayed: true },
          }
        : generated,
    ],
  });
  if (generated.kind !== 'accepted')
    throw new Error(`draw refused: ${JSON.stringify(generated)}`);
  const drawId = generated.receipt.aggregate.id;
  const readRound = tabRead(
    world,
    'host-round',
    hostRoundViewSchema,
    readHostRound({ store, authorize }),
    (input) => ({ ...input }),
  );
  const draftRead = await readRound(as(world.bots.Director!), {
    lobbyId,
    eventId,
    tabRoundId: roundId,
  });
  const expectedFixtures = await sql<
    { fixture_id: string }[]
  >`select fixture_id from draw_fixtures where draw_id=${drawId} order by fixture_id`;
  const foreignRead = await readRound(as(world.bots.Director!), {
    lobbyId: world.made.get('standing-lobby')!,
    eventId,
    tabRoundId: roundId,
  });
  const addressedAgain = await readRound(as(world.bots.Director!), {
    lobbyId,
    eventId,
    tabRoundId: roundId,
  });
  assert({
    given: 'the actual generated draft and its retained source guards',
    should:
      'read every stored fixture under the Draw area and conceal a foreign-lobby target',
    actual: [
      draftRead?.kind,
      draftRead?.guards,
      draftRead?.kind === 'draft'
        ? draftRead.draw.recordGroups
            .flatMap((group) =>
              group.fixtures.map((fixture) => fixture.fixtureId),
            )
            .sort()
        : null,
      foreignRead,
      addressedAgain?.kind,
    ],
    expected: [
      'draft',
      {
        draw: 1,
        entries: Number(event!.entries_version),
        settings: Number(event!.settings_version),
        results: 1,
        timeSlot: (
          await sql<
            { version: number | null }[]
          >`select s.version from tab_rounds r left join time_slots s on s.id=r.time_slot_id where r.id=${roundId}`
        )[0]!.version,
      },
      expectedFixtures.map((fixture) => fixture.fixture_id),
      null,
      'draft',
    ],
  });

  const [stored] =
    await sql`select method, status, inputs->'engine'->>'seed' as seed, inputs->'engine'->'engine'->>'engine' as engine from draws where id=${drawId}`;
  const placed =
    await sql`select f.id, count(e.entry_id)::int as entries from fixtures f join draw_fixtures d on d.fixture_id=f.id join fixture_entries e on e.fixture_id=f.id where d.draw_id=${drawId} group by f.id order by f.id`;
  assert({
    given: 'the draw reloaded from PostgreSQL',
    should:
      'retain the actual calculation and two genuine pairings without making Rooms',
    actual: [
      stored && { ...stored },
      placed.map((row: { entries: number }) => row.entries),
      (await sql`select id from rooms where lobby_id=${lobbyId}`).length,
    ],
    expected: [
      {
        method: 'computed',
        status: 'draft',
        seed: 'ab'.repeat(32),
        engine: 'tab-engine@2',
      },
      [2, 2],
      0,
    ],
  });
  const [slot] =
    await sql`select version from time_slots where id=${world.made.get('time-slot')!}`;
  const assign = {
    version: 1,
    commandId: createId(),
    expected: { draw: 1, timeSlot: Number(slot?.version) },
    command: { type: 'assign-judges', drawId },
  };
  assert({
    given: 'one available judge for two fixtures',
    should: 'refuse before storing any partial panel',
    actual: await send(as(world.bots.Director!), lobbyId, assign),
    expected: { kind: 'refused', refusal: 'judges-insufficient' },
  });
  const register = tabLobbyCommand(world, 'judges');
  const invited = await register(as(world.bots.Director!), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'invite-judge',
      actorId: world.bots['Judge B']!.actorId,
      schoolOrganizationId: null,
      chairQualified: true,
      eventIds: [eventId],
    },
  });
  if (invited.kind !== 'accepted')
    throw new Error('second judge invitation refused');
  const [registered] =
    await sql`select id from tournament_judges where lobby_id=${lobbyId} and actor_id=${world.bots['Judge B']!.actorId}`;
  if (!registered) throw new Error('second judge row is missing');
  const judgeId = String(registered.id);
  for (const command of [
    { type: 'accept-judge-invitation', tournamentJudgeId: judgeId },
    {
      type: 'set-judge-availability',
      tournamentJudgeId: judgeId,
      availability: [
        { timeSlotId: world.made.get('time-slot')!, available: true },
      ],
    },
  ]) {
    const answer = await register(as(world.bots['Judge B']!), lobbyId, {
      version: 1,
      commandId: createId(),
      expected: {},
      command,
    });
    if (answer.kind !== 'accepted')
      throw new Error(
        `second judge registration refused: ${JSON.stringify(answer)}`,
      );
  }
  const assigned = await send(as(world.bots.Director!), lobbyId, assign);
  assert({
    given:
      'the same previously refused command after a second real judge accepts',
    should: 'seat both panels without creating a draw version',
    actual: [
      assigned.kind,
      (await sql`select * from fixture_judges where lobby_id=${lobbyId}`)
        .length,
      (await sql`select * from draws where tab_round_id=${roundId}`).length,
    ],
    expected: ['accepted', 2, 1],
  });
  const edited = await send(as(world.bots.Director!), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { draw: 1 },
    command: {
      type: 'edit-draw',
      basedOnDrawId: drawId,
      edits: [{ type: 'swap-sides', fixtureId: String(placed[0]!.id) }],
    },
  });
  if (edited.kind !== 'accepted')
    throw new Error(`edit refused: ${JSON.stringify(edited)}`);
  const discard = {
    version: 1,
    commandId: createId(),
    expected: { draw: 2 },
    command: { type: 'discard-draft', drawId: edited.receipt.aggregate.id },
  };
  const manage = tabCommand(world, 'organization');
  const [lobbyGuard] =
    await sql`select version from lobbies where id=${lobbyId}`;
  const grant = await manage(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(lobbyGuard!.version) },
    command: {
      type: 'give-grant',
      scope: { kind: 'lobby', lobbyId },
      userId: world.bots.Coach!.userId,
      roleId: presetStaffRoleId,
      expiresAt: null,
    },
  });
  if (grant.kind !== 'accepted')
    throw new Error(`Draft replay grant: ${JSON.stringify(grant)}`);
  const discarded = await send(as(world.bots.Coach!), lobbyId, discard);
  assert({
    given: 'an edited draft discarded and then retried after its row is gone',
    should:
      'remove only its orphan fixture and replay the original journal receipt',
    actual: [
      discarded.kind,
      await send(as(world.bots.Coach!), lobbyId, discard),
      (await sql`select * from draws where tab_round_id=${roundId}`).length,
      (await sql`select * from fixtures where tab_round_id=${roundId}`).length,
    ],
    expected: [
      'accepted',
      discarded.kind === 'accepted'
        ? {
            ...discarded,
            receipt: { ...discarded.receipt, replayed: true },
          }
        : discarded,
      1,
      2,
    ],
  });
  const [actualGrant] =
    await sql`select id from grants where lobby_id=${lobbyId} and user_id=${world.bots.Coach!.userId} and role_id=${presetStaffRoleId} and revoked_at is null`;
  const [revokeGuard] =
    await sql`select version from lobbies where id=${lobbyId}`;
  const revoked = await manage(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(revokeGuard!.version) },
    command: {
      type: 'remove-grant',
      scope: { kind: 'lobby', lobbyId },
      grantId: String(actualGrant!.id),
    },
  });
  if (revoked.kind !== 'accepted')
    throw new Error(`Draft replay revocation: ${JSON.stringify(revoked)}`);
  assert({
    given:
      'the actual discarded draft is gone and the original actor’s only draw grant is revoked',
    should: 'deny receipt replay using current account and lobby authority',
    actual: await deniedAsNotFound(() =>
      send(as(world.bots.Coach!), lobbyId, discard),
    ),
    expected: true,
  });
  world.made.set('draw', drawId);
};
