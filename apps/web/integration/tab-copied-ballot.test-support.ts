import { organizationCommand } from '../src/features/tab/operations/organization';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { daisyWinnerBallot, storedBallotDefinition } from '@daisy/protocol';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readEventBallot } from '../src/features/tab/reads/event-ballot';
import {
  as,
  underFence,
} from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/** A genuinely foreign organization-owned source; only its named template is copied. */
export const copyForeignBallot = async (
  world: World,
  mode: 'copy' | 'detach',
) => {
  const { sql } = world;
  const foreignOrganization = await organizationCommand({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  })(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-organization',
      kind: 'school',
      name: 'Foreign source catalogue',
      handle: `source-${createId()}`,
    },
  });
  if (foreignOrganization.kind !== 'accepted')
    throw new Error('Actual foreign source organization refused');
  const organizationId = foreignOrganization.receipt.aggregate.id,
    lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!;
  const sourceId = createId(),
    siblingId = createId();
  const body = {
    ...daisyWinnerBallot,
    points: {
      ...daisyWinnerBallot.points!,
      per: 'seat' as const,
      scale: { min: 0.25, max: 1.25, step: 0.1 },
      default: 0.35,
      criteria: { kind: 'holistic' as const },
      weights: null,
    },
    speakerRanks: true,
    written: { reason: null, feedback: null },
  };
  // Catalogue fixture only: ownership/content are explicit; the actual copy,
  // detach, command receipts and host reads below use production operations.
  await underFence(world, { organizationId }, async (scoped) => {
    for (const id of [sourceId, siblingId]) {
      await scoped`insert into ballot_definitions(id,organization_id,name,current_version) values(${id},${organizationId},${id === sourceId ? 'Foreign exact source' : 'Foreign hidden sibling'},1)`;
      await scoped`insert into ballot_definition_versions(ballot_definition_id,version,organization_id,definition) values(${id},1,${organizationId},${JSON.stringify(storedBallotDefinition(id, 1, body))}::text::jsonb)`;
    }
  });
  const store = createTabStore(world.database);
  const send = settingCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const created = await send(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-template',
      organizationId,
      name: 'Foreign immutable ballot',
      format: { id: 'freestyle', version: 1 },
      ballotDefinition: { id: sourceId, version: 1 },
    },
  });
  if (created.kind !== 'accepted')
    throw new Error(`Create source template: ${JSON.stringify(created)}`);
  const templateId = created.receipt.aggregate.id;
  const eventCommand = async (command: SettingCommand) => {
    const [event] = await underFence<{
      version: number;
      entries_version: number;
      settings_version: number;
    }>(
      world,
      { lobbyId },
      (scoped) =>
        scoped`select version,entries_version,settings_version from events where id=${eventId}`,
    );
    const envelope = {
      version: 1,
      commandId: createId(),
      expected: {
        event: Number(event!.version),
        entries: Number(event!.entries_version),
        settings: Number(event!.settings_version),
      },
      command,
    };
    const answer = await send(as(world.bots.Director!), envelope);
    if (answer.kind !== 'accepted')
      throw new Error(
        `Foreign source ${command.type}: ${JSON.stringify(answer)}`,
      );
    return { answer, envelope };
  };
  // The setup's original Daisy follow is stopped by its real command first.
  await eventCommand({ type: 'stop-following-template', eventId });
  if (mode === 'detach')
    await eventCommand({ type: 'follow-template', eventId, templateId });
  const { envelope } = await eventCommand(
    mode === 'copy'
      ? { type: 'copy-template', eventId, templateId }
      : { type: 'stop-following-template', eventId },
  );
  const replay = await send(as(world.bots.Director!), envelope);
  const [copy] =
    await sql`select d.id,d.organization_id,d.lobby_id,v.definition,v.copied_from_ballot_definition_id,v.copied_from_ballot_definition_version,e.template_id from events e join ballot_definitions d on d.id=e.ballot_definition_id join ballot_definition_versions v on v.ballot_definition_id=d.id and v.version=e.ballot_definition_version where e.id=${eventId}`;
  const copyId = String(copy!.id);
  assert({
    given: `actual cross-organization ${mode} and command replay`,
    should:
      'create one correctly owned immutable body with real source provenance and no retained template link',
    actual: {
      copy: copy!,
      replay: replay.kind === 'accepted' && replay.receipt.replayed,
      count: (
        await sql`select count(*)::int n from ballot_definition_versions where copied_from_ballot_definition_id=${sourceId}`
      )[0]!.n,
    },
    expected: {
      copy: {
        id: copyId,
        organization_id: null,
        lobby_id: lobbyId,
        definition: storedBallotDefinition(copyId, 1, body),
        copied_from_ballot_definition_id: sourceId,
        copied_from_ballot_definition_version: 1,
        template_id: null,
      },
      replay: true,
      count: 1,
    },
  });
  const view = await readEventBallot({
    store,
    authorize,
    now: world.clock.now,
  })(as(world.bots.Director!), { lobbyId, eventId });
  assert({
    given: 'the copied event host read',
    should:
      'retain the full owned canonical body without granting either foreign catalogue entry',
    actual: [
      view?.definition,
      view?.definitions.some(
        (row) => row.id === sourceId || row.id === siblingId,
      ),
    ],
    expected: [
      {
        source: { kind: 'stored', id: copyId, version: 1 },
        ballot: storedBallotDefinition(copyId, 1, body),
      },
      false,
    ],
  });
  world.made.set('copied-ballot', copyId);
  return {
    sourceId,
    copyId,
    definition: storedBallotDefinition(copyId, 1, body),
  };
};
