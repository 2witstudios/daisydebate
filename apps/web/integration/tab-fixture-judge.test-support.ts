import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import type { TabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { committedEventRoom } from './tab-event-room-direction.test-support';
import type { Bot } from './tab-tournament.test-support';

/** An actual spare accepts its invitation and declares the actual slot, through existing guarded commands. */
export async function registerFixtureJudge(input: {
  readonly owner: SQL;
  readonly store: Pick<TabStore, 'judgeRegistrationCommand'>;
  readonly world: Awaited<ReturnType<typeof committedEventRoom>>;
  readonly person: Bot;
}) {
  const { owner, store, world, person } = input,
    lobbyId = world.made.get('tournament-lobby')!;
  const register = judgeRegistrationCommand({
    store,
    authorize,
    now: () => new Date().toISOString(),
    newId: createId,
    minorsReleased: async () => false,
  });
  const invitation = await register(as(world.bots.Director!), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'invite-judge',
      actorId: person.actorId,
      schoolOrganizationId: null,
      chairQualified: true,
      eventIds: [world.made.get('event')!],
    },
  });
  if (invitation.kind !== 'accepted')
    throw new Error(
      `Spare judge invitation refused: ${JSON.stringify(invitation)}`,
    );
  const [spare] = await owner<
    { id: string; actor_id: string }[]
  >`select id,actor_id from tournament_judges where lobby_id=${lobbyId} and actor_id=${person.actorId}`;
  if (!spare) throw new Error('Invited spare judge is missing');
  for (const command of [
    { type: 'accept-judge-invitation', tournamentJudgeId: spare.id },
    {
      type: 'set-judge-availability',
      tournamentJudgeId: spare.id,
      availability: [
        { timeSlotId: world.made.get('time-slot')!, available: true },
      ],
    },
  ] as const) {
    const answer = await register(as(person), lobbyId, {
      version: 1,
      commandId: createId(),
      expected: {},
      command,
    });
    if (answer.kind !== 'accepted')
      throw new Error('Spare judge acceptance/availability refused');
  }
  return spare;
}
