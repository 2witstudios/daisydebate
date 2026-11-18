import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import {
  as,
  StageFailed,
} from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

export const leagueConfigurationStage = async (world: World): Promise<void> => {
  const lobbyId = world.made.get('standing-lobby')!;
  const organizationId = world.made.get('league')!;
  const director = world.bots.Director!;
  const store = createTabStore(world.database);
  const send = settingCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const template = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'create-template',
      organizationId,
      name: 'League freestyle',
      format: { id: 'freestyle', version: 1 },
      ballotDefinition: null,
    },
  });
  if (template.kind !== 'accepted')
    throw new StageFailed(`league template: ${JSON.stringify(template)}`);
  const templateId = template.receipt.aggregate.id;
  world.made.set('league-template', templateId);
  const enforced = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: { settings: 1 },
    command: {
      type: 'set-setting',
      scope: { kind: 'organization', id: organizationId },
      key: 'room.visibility',
      value: { value: 'unlisted' },
      hold: 'enforced',
    },
  });
  if (enforced.kind !== 'accepted')
    throw new StageFailed('league enforcement failed');
  const offer = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: { lobby: 2 },
    command: { type: 'offer-template', lobbyId, templateId },
  });
  if (offer.kind !== 'accepted') throw new StageFailed('league offer failed');
  const setup = setupCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const pooled = await setup(as(director), {
    version: 1,
    commandId: createId(),
    expected: { lobby: 3 },
    command: {
      type: 'add-resolution',
      lobbyId,
      pool: { kind: 'new', name: 'League topics' },
      text: 'Resolved: this house supports competition.',
    },
  });
  if (pooled.kind !== 'accepted') throw new StageFailed('league pool failed');
  const read = readStandingRoomDraft({
    store,
    authorize,
    now: world.clock.now,
  });
  const draft = await read(as(world.bots.Coach!), { lobbyId, templateId });
  assert({
    given: 'an active league member and the stored offered template',
    should: 'read the real create-room form pins',
    actual: draft?.templates.map((row) => [
      row.templateId,
      row.format.formatId,
      row.format.formatVersion,
    ]),
    expected: [[templateId, 'freestyle', 1]],
  });
  const visibility = draft?.draft.settings.find(
    (row) => row.key === 'room.visibility',
  );
  assert({
    given: 'the organization policy in the room-draft chain',
    should: 'show its value and enforcement source',
    actual: visibility && [
      visibility.value,
      visibility.locked,
      visibility.source,
    ],
    expected: [
      { value: 'unlisted' },
      'enforced',
      { kind: 'organization', id: organizationId, name: 'Valley League' },
    ],
  });
  assert({
    given: 'a person outside the league and an unoffered template',
    should: 'hide each room draft',
    actual: [
      await read(as(world.bots['Judge A']!), { lobbyId, templateId }),
      await read(as(director), { lobbyId, templateId: createId() }),
    ],
    expected: [null, null],
  });
};
