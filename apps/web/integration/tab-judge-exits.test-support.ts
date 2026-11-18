import { inTabTestTransaction } from './tab-test-transaction.test-support';
import { authorize, type AuthorizationInput } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import {
  as,
  deniedAsNotFound,
  StageFailed,
} from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/** A fixed age source for the live account producer, on a test database only. */
const seventeenYearsAgo = () => {
  const now = new Date();
  return `${now.getUTCFullYear() - 17}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};
const withoutAnswer = (input: AuthorizationInput) => {
  const { answer, ...context } = input.context;
  void answer;
  return authorize({ ...input, context });
};

/** Closed minors flows still let a bounded member decline an old invitation. */
export const judgeExitStage = async (world: World): Promise<void> => {
  const minor = world.bots['Judge B']!;
  const parent = world.bots.Coach!;
  const director = world.bots.Director!;
  const lobbyId = world.made.get('tournament-lobby')!;
  const allowedLobbyId = world.made.get('standing-lobby')!;
  const store = createTabStore(world.database);
  const dependencies = {
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
    minorsReleased: async () => false,
  };
  await inTabTestTransaction(world.sql, async (sql) => {
    await sql`reset role`;
    await sql`update account_age set birth_month = ${seventeenYearsAgo()}, version = version + 1 where user_id = ${minor.userId}`;
    await sql`update users set version = version + 1 where id = ${minor.userId}`;
    await sql`set local role daisy_web`;
  });
  const send = judgeRegistrationCommand(dependencies);
  const invite = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'invite-judge',
      actorId: minor.actorId,
      schoolOrganizationId: null,
      chairQualified: false,
    },
  };
  assert({
    given: 'the minors flag closed',
    should: 'refuse creating a minor judge invitation',
    actual: await deniedAsNotFound(() => send(as(director), lobbyId, invite)),
    expected: true,
  });
  const judgeId = createId();
  await inTabTestTransaction(world.sql, async (sql) => {
    await sql`reset role`;
    const linkId = createId();
    await sql`insert into guardian_links (id, guardian_user_id, minor_user_id, kind, status) values (${linkId}, ${parent.userId}, ${minor.userId}, 'parent', 'active')`;
    await sql`insert into restrictions (guardian_link_id, guardian_user_id, minor_user_id, limits_lobbies) values (${linkId}, ${parent.userId}, ${minor.userId}, true)`;
    await sql`insert into restriction_lobbies (guardian_link_id, guardian_user_id, minor_user_id, lobby_id) values (${linkId}, ${parent.userId}, ${minor.userId}, ${allowedLobbyId})`;
    // This represents an existing footprint; guardian writes and new minor
    // invitations remain closed to the runtime role and the application.
    await sql`insert into tournament_judges (id, lobby_id, actor_id, status) values (${judgeId}, ${lobbyId}, ${minor.actorId}, 'invited')`;
    await sql`update users set version = version + 1 where id = ${minor.userId}`;
    await sql`set local role daisy_web`;
  });
  const decline = {
    version: 1,
    commandId: createId(),
    expected: {},
    command: { type: 'decline-judge-invitation', tournamentJudgeId: judgeId },
  };
  const missingAnswer = judgeRegistrationCommand({
    ...dependencies,
    authorize: withoutAnswer,
  });
  assert({
    given: 'the same stored boundary and a missing decision answer',
    should: 'expose the original restricted-decline failure',
    actual: await deniedAsNotFound(() =>
      missingAnswer(as(minor), lobbyId, decline),
    ),
    expected: true,
  });
  const answer = await send(as(minor), lobbyId, decline);
  if (answer.kind !== 'accepted')
    throw new StageFailed('restricted minor decline refused');
  const [stored] =
    await world.sql`select status from tournament_judges where id = ${judgeId}`;
  assert({
    given: 'the actual decline answer passed into the evaluator',
    should:
      'allow the bounded member to leave the invitation while the minors flag stays closed',
    actual: stored?.status,
    expected: 'declined',
  });
};
