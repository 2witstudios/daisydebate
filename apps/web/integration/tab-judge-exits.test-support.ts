import { seedGuardianLink } from './guardian-link.test-support';
import { inTabTestTransaction } from './tab-test-transaction.test-support';
import { authorize } from '@daisy/auth/authorization';
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
/** A minor can decline their own old invitation while the minors flag is closed. */
export const judgeExitStage = async (world: World): Promise<void> => {
  const minor = world.bots['Judge B']!;
  const parent = world.bots.Coach!;
  const director = world.bots.Director!;
  const lobbyId = world.made.get('tournament-lobby')!;
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
    await seedGuardianLink(sql, parent.userId, minor.userId);
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
  assert({
    given:
      'a linked minor with a stored invitation while the minors flag is closed',
    should: 'refuse accepting the invitation',
    actual: await deniedAsNotFound(() =>
      send(as(minor), lobbyId, {
        ...decline,
        commandId: createId(),
        command: {
          type: 'accept-judge-invitation',
          tournamentJudgeId: judgeId,
        },
      }),
    ),
    expected: true,
  });
  assert({
    given: 'a parent linked to the minor who was invited',
    should: 'refuse the parent declining the invitation on the minor’s behalf',
    actual: await deniedAsNotFound(() =>
      send(as(parent), lobbyId, { ...decline, commandId: createId() }),
    ),
    expected: true,
  });
  const answer = await send(as(minor), lobbyId, decline);
  if (answer.kind !== 'accepted')
    throw new StageFailed('minor decline refused');
  const [stored] =
    await world.sql`select status from tournament_judges where id = ${judgeId}`;
  assert({
    given: 'the invited minor declines',
    should:
      'allow them to leave the invitation while the minors flag stays closed',
    actual: stored?.status,
    expected: 'declined',
  });
};
