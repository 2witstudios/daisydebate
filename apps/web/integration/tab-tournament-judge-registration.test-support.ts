import { hostRosterViewSchema } from '@daisy/protocol/lobby/entry-read';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import {
  as,
  deniedAsNotFound,
  StageFailed,
} from './tab-tournament-organization-wiring.test-support';
import {
  readTab,
  tabLobbyCommand,
} from './tab-tournament-transport.test-support';
import type { World } from './tab-tournament.test-support';

export const judgeRegistrationStage = async (world: World): Promise<void> => {
  const director = world.bots.Director!;
  const coach = world.bots.Coach!;
  const judgeA = world.bots['Judge A']!;
  const judgeB = world.bots['Judge B']!;
  const lobbyId = world.made.get('tournament-lobby')!;
  const eventId = world.made.get('event')!;
  const slotId = world.made.get('time-slot')!;
  const [before] =
    await world.sql`select version from users where id = ${judgeA.userId}`;
  const send = tabLobbyCommand(world, 'judges');
  const invitation = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'invite-judge',
      actorId: judgeA.actorId,
      schoolOrganizationId: null,
      chairQualified: true,
      eventIds: [eventId],
    },
  };
  assert({
    given: 'a member without tournament host authority',
    should: 'deny a judge invitation',
    actual: await deniedAsNotFound(() => send(as(coach), lobbyId, invitation)),
    expected: true,
  });
  const invited = await send(as(director), lobbyId, invitation);
  if (invited.kind !== 'accepted')
    throw new StageFailed('judge invitation refused');
  const [stored] =
    await world.sql`select id, status from tournament_judges where lobby_id = ${lobbyId} and actor_id = ${judgeA.actorId}`;
  if (!stored) throw new StageFailed('judge invitation is missing');
  const judgeId = String(stored.id);
  world.made.set('judge-a', judgeId);
  const accept = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: { type: 'accept-judge-invitation', tournamentJudgeId: judgeId },
  };
  assert({
    given: 'an invitation to another judge',
    should: 'refuse an outsider answering it',
    actual: await deniedAsNotFound(() => send(as(judgeB), lobbyId, accept)),
    expected: true,
  });
  const accepted = await send(as(judgeA), lobbyId, accept);
  assert({
    given: 'the invited judge answering',
    should: 'accept and replay the same receipt',
    actual: [accepted.kind, await send(as(judgeA), lobbyId, accept)],
    expected: [
      'accepted',
      accepted.kind === 'accepted'
        ? { ...accepted, receipt: { ...accepted.receipt, replayed: true } }
        : accepted,
    ],
  });
  const availability = await send(as(judgeA), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'set-judge-availability',
      tournamentJudgeId: judgeId,
      availability: [{ timeSlotId: slotId, available: true }],
    },
  });
  assert({
    given: 'an accepted judge selecting the real tournament slot',
    should: 'persist that availability',
    actual: availability.kind,
    expected: 'accepted',
  });
  const rows =
    await world.sql`select j.status, j.chair_qualified, a.available, e.event_id from tournament_judges j join judge_availability a on a.tournament_judge_id = j.id join judge_events e on e.tournament_judge_id = j.id where j.id = ${judgeId}`;
  assert({
    given: 'the accepted commands after reload',
    should: 'retain the judge, qualification, event and availability',
    actual: rows.map(
      (row: {
        status: string;
        chair_qualified: boolean;
        available: boolean;
        event_id: string;
      }) => ({ ...row }),
    ),
    expected: [
      {
        status: 'accepted',
        chair_qualified: true,
        available: true,
        event_id: eventId,
      },
    ],
  });
  if (world.http) {
    const roster = await readTab(
      world.http,
      director,
      'host-roster',
      { lobbyId, eventId },
      hostRosterViewSchema,
    );
    const judge = roster?.judges.groups
      .flatMap((group) => group.judges)
      .find((row) => row.id === judgeId);
    assert({
      given: 'the judge accepted and made themselves available',
      should: 'show a judge cleared for the event and free in its time slot',
      actual: [judge?.clearedFor, judge?.slots],
      expected: [[eventId], [{ state: 'free' }]],
    });
  }
  const lateDecline = await send(as(judgeA), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: {},
    command: { type: 'decline-judge-invitation', tournamentJudgeId: judgeId },
  });
  assert({
    given: 'an already settled invitation',
    should: 'refuse a later decline',
    actual: lateDecline,
    expected: { kind: 'refused', refusal: 'invitation-closed' },
  });
  const [after] =
    await world.sql`select version from users where id = ${judgeA.userId}`;
  assert({
    given:
      'invitation, acceptance and availability, with replayed and refused commands',
    should: 'invalidate the judge account exactly once per accepted change',
    actual: Number(after?.version) - Number(before?.version),
    expected: 3,
  });
};
