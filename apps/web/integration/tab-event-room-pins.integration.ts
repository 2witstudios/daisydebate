import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { formatDefinitionSchema } from '@daisy/protocol/format';
import { roomExecutionPlanSchema } from '@daisy/protocol/room';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import { preparePublication } from './tab-publication-setup.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type World,
} from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const common = (world: World) => ({
  store: createTabStore(world.database),
  authorize,
  now: world.clock.now,
  newId: createId,
});
const setting = async (
  world: World,
  command: unknown,
  expected: unknown = {},
) => {
  const answer = await settingCommand(common(world))(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected,
    command,
  });
  if (answer.kind !== 'accepted')
    throw new Error(`Pin setting refused: ${JSON.stringify(answer)}`);
  return answer.receipt;
};
const setup = async (world: World, command: unknown) => {
  const lobbyId = world.made.get('tournament-lobby')!;
  const [lobby] =
    await world.sql`select version from lobbies where id=${lobbyId}`;
  const answer = await setupCommand(common(world))(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(lobby!.version) },
    command,
  });
  if (answer.kind !== 'accepted')
    throw new Error(`Pin setup refused: ${JSON.stringify(answer)}`);
};
const eventGuard = async (world: World) => {
  const guard = await createTabStore(world.database).tournamentEventSettings(
    {
      viewerUserId: world.bots.Director!.userId,
      lobbyId: world.made.get('tournament-lobby')!,
      eventId: world.made.get('event')!,
    },
    async (facts) =>
      facts
        ? {
            event: facts.configuration.event.version,
            settings: facts.configuration.event.settingsVersion,
            entries: facts.configuration.event.entriesVersion,
          }
        : null,
  );
  if (!guard) throw new Error('The addressed event guard is missing');
  return guard;
};
const configure = async (world: World, mode: 'draw' | 'strike') => {
  const lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!,
    roundId = world.made.get('tab-round')!;
  const [round] =
    await world.sql`select resolution_pool_id from tab_rounds where id=${roundId}`;
  let drawSize = 0,
    firstStriker = '';
  let rule: unknown = { method: 'draw', release: 'manual' };
  if (mode === 'strike') {
    const [revision] =
      await world.sql`select r.format_id,r.version,r.definition from format_revisions r join format_presets p on p.format_id=r.format_id and p.format_version=r.version join formats f on f.id=r.format_id where f.created_by_actor_id is null and r.definition->'seats'->'sides'='{"affirmative":1,"negative":1}'::jsonb and (r.definition->'seats'->>'judges')::int=1 and r.definition #> '{configurable,resolutionDraw,sources}' @> '["host"]'::jsonb order by r.format_id,p.version desc limit 1`;
    if (!revision)
      throw new Error('No approved two-side host-list draw definition');
    const definition = formatDefinitionSchema.parse(revision.definition),
      bounds = definition.configurable.resolutionDraw;
    if (!bounds) throw new Error('The selected definition has no draw bounds');
    const template = await setting(world, {
      type: 'create-template',
      organizationId: world.made.get('league')!,
      name: 'Strike template',
      format: {
        id: String(revision.format_id),
        version: Number(revision.version),
      },
      ballotDefinition: null,
    });
    await setting(
      world,
      { type: 'copy-template', eventId, templateId: template.aggregate.id },
      await eventGuard(world),
    );
    drawSize = bounds.drawSize.min;
    firstStriker = bounds.firstStrikers[bounds.firstStrikers.length - 1]!;
    const position = definition.sides.findIndex(
      (side) => side.key === firstStriker,
    );
    if (position !== 0 && position !== 1)
      throw new Error('Strike has no actual two-side position');
    rule = {
      method: 'strike',
      drawSize,
      strikeWindowMs: bounds.strikeWindowMs.min,
      firstStriker: position,
    };
  }
  const guard = await eventGuard(world);
  await setting(
    world,
    {
      type: 'set-setting',
      scope: { kind: 'event', id: eventId },
      key: 'resolution.rule',
      value: rule,
      hold: 'default',
    },
    { settings: guard.settings },
  );
  await setup(world, {
    type: 'update-tab-round',
    lobbyId,
    tabRoundId: roundId,
    name: 'Round 1',
    resolution: {
      poolId: String(round!.resolution_pool_id),
      poolResolutionId: null,
    },
  });
  const count = mode === 'strike' ? 25 : 1;
  for (let index = 0; index < count; index += 1)
    await setup(world, {
      type: 'add-resolution',
      lobbyId,
      pool: { kind: 'existing', poolId: String(round!.resolution_pool_id) },
      text: `Resolution ${index + 1} from the actual pool.`,
    });
  if (mode === 'strike')
    await setup(world, {
      type: 'add-resolution',
      lobbyId,
      pool: { kind: 'existing', poolId: String(round!.resolution_pool_id) },
      text: 'RESOLUTION 1 FROM THE ACTUAL POOL.',
    });
  return { drawSize, firstStriker, poolId: String(round!.resolution_pool_id) };
};
for (const mode of ['draw', 'strike'] as const)
  test(`event Rooms pin the actual ${mode} rule without borrowing Daisy's bank`, async () => {
    await withRolledBackDatabase(databaseUrl, {
      seed: (sql) =>
        createBots(sql, [
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
        ]),
      work: async (database, bots, sql) => {
        const world = {
          database,
          sql,
          bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
          clock: scriptClock(),
          made: new Map<string, string>(),
        };
        let configured: {
          drawSize: number;
          firstStriker: string;
          poolId: string;
        } | null = null;
        await preparePublication(world, 'copy', async (prepared) => {
          configured = await configure(prepared, mode);
        });
        if (!configured)
          throw new Error('Missing actual resolution configuration');
        const input: {
          drawSize: number;
          firstStriker: string;
          poolId: string;
        } = configured;
        const lobbyId = world.made.get('tournament-lobby')!,
          roundId = world.made.get('tab-round')!;
        const [slot] =
          await sql`select version from time_slots where id=${world.made.get('time-slot')!}`;
        const [event] =
          await sql`select entries_version,format_id,format_version from events where id=${world.made.get('event')!}`;
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
            drawId: world.made.get('draw')!,
            overrides: [],
          },
        };
        const send = drawCommand({
          ...common(world),
          competition: firstDrawCompetition,
        });
        const accepted = await send(
          as(world.bots.Director!),
          lobbyId,
          envelope,
        );
        if (accepted.kind !== 'accepted')
          throw new Error(
            `Actual ${mode} publication refused: ${JSON.stringify(accepted)}`,
          );
        const rooms = await sql<
          {
            id: string;
            topic: string | null;
            format_id: string;
            format_version: number;
            execution_plan: unknown;
          }[]
        >`select id,topic,format_id,format_version,execution_plan from rooms where lobby_id=${lobbyId} order by id`;
        const [selected] =
          await sql`select r.pool_resolution_id,r.resolution_released_at,p.text from tab_rounds r left join pool_resolutions p on p.id=r.pool_resolution_id where r.id=${roundId}`;
        const pool = await sql<
          { text: string }[]
        >`select text from pool_resolutions where pool_id=${input.poolId} and retired_at is null`;
        const wording = new Set(
          pool.map((row) => row.text.trim().toLocaleLowerCase()),
        );
        const plans = rooms.map((room) =>
          roomExecutionPlanSchema.parse(room.execution_plan),
        );
        assert({
          given: `actual ${mode} publication through its guarded command and addressed pool`,
          should:
            'pin exactly the current legal source and preserve unreleased/manual wording policy',
          actual: [
            rooms.length,
            rooms.every(
              (room) =>
                room.format_id === event!.format_id &&
                Number(room.format_version) === Number(event!.format_version),
            ),
            mode === 'draw'
              ? rooms.every(
                  (room) =>
                    room.topic === selected?.text &&
                    wording.has(String(room.topic).toLocaleLowerCase()),
                )
              : rooms.every((room) => room.topic === null),
            mode === 'draw'
              ? plans.every((plan) => !plan.resolutionDraw.enabled)
              : plans.every(
                  (plan) =>
                    plan.resolutionDraw.enabled &&
                    plan.resolutionDraw.source.kind === 'host' &&
                    plan.resolutionDraw.source.resolutions.length ===
                      input.drawSize &&
                    new Set(
                      plan.resolutionDraw.source.resolutions.map((text) =>
                        text.toLocaleLowerCase(),
                      ),
                    ).size === input.drawSize &&
                    plan.resolutionDraw.source.resolutions.every((text) =>
                      wording.has(text.toLocaleLowerCase()),
                    ) &&
                    plan.resolutionDraw.firstStriker === input.firstStriker,
                ),
            mode === 'draw'
              ? selected?.pool_resolution_id !== null
              : selected?.pool_resolution_id === null,
            selected?.resolution_released_at,
          ],
          expected: [2, true, true, true, true, null],
        });
        const replay = await send(as(world.bots.Director!), lobbyId, envelope);
        const after = await sql<
          { id: string; execution_plan: unknown }[]
        >`select id,execution_plan from rooms where lobby_id=${lobbyId} order by id`;
        assert({
          given:
            'the same publication request retried with new server entropy available',
          should:
            'recover its original receipt and exact frozen choices without a second selection',
          actual: [
            replay.kind === 'accepted' ? replay.receipt.replayed : false,
            after,
          ],
          expected: [
            true,
            rooms.map(({ id, execution_plan }) => ({ id, execution_plan })),
          ],
        });
      },
    });
  }, 60_000);
