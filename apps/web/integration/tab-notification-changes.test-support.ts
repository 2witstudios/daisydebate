import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { fixtureCommand } from '../src/features/tab/operations/fixture-command';
import { readNotificationItems } from '../src/features/notifications/read-notifications';
import { as } from './tab-tournament-organization-wiring.test-support';
import { withTournamentNotificationReader } from './tab-tournament-notifications.test-support';
import type { World } from './tab-tournament.test-support';

/** Exercises successful unassignment/assignment before Start, command replay and a late notification failure. */
export async function proveTournamentNotificationChanges(
  world: World,
): Promise<void> {
  const send = fixtureCommand({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const lobbyId = world.made.get('tournament-lobby')!;
  const [fixture] = await world.sql<
    {
      id: string;
      version: number;
      tournament_judge_id: string;
      actor_id: string;
      user_id: string;
    }[]
  >`
    select f.id,f.version,fj.tournament_judge_id,j.actor_id,a.user_id from fixtures f
    join fixture_judges fj on fj.fixture_id=f.id join tournament_judges j on j.id=fj.tournament_judge_id
    join actors a on a.id=j.actor_id where f.tab_round_id=${world.made.get('tab-round')!} and f.id<>${world.made.get('first-fixture')!}`;
  if (!fixture) throw new Error('Actual second fixture missing');
  const expectedPeople = await world.sql<
    { user_id: string }[]
  >`select a.user_id from fixtures f join room_participants p on p.room_id=f.room_id join actors a on a.id=p.actor_id where f.tab_round_id=${world.made.get('tab-round')!} order by a.user_id`;
  for (const kind of ['tournament_draw_changed', 'tournament_room_ready']) {
    const actualPeople = await world.sql<
      { user_id: string }[]
    >`select n.user_id from notifications n join action_history h on h.command_id=n.tab_command_id where n.notification_lobby_id=${lobbyId} and n.kind=${kind} and h.type='publish-draw' order by n.user_id`;
    assert({
      given:
        'the actual cast seated by publication, alongside unrelated accepted judges and officials',
      should: 'notify exactly the people whose fixture was published',
      actual: actualPeople.map((row) => row.user_id),
      expected: expectedPeople.map((row) => row.user_id),
    });
  }
  await withTournamentNotificationReader(world, async (store) => {
    const read = () =>
      readNotificationItems(store, {
        userId: fixture.user_id,
        query: { unreadOnly: false, after: null },
        now: new Date().toISOString(),
      });
    const before = await read();
    assert({
      given: 'the genuine assigned judge before Start',
      should: 'see their assignment and ready Room in Notifications',
      actual: [
        before.items.some(
          (item) => item.text === 'You have been assigned to judge.',
        ),
        before.items.some(
          (item) => item.text === 'Your tournament Room is ready.',
        ),
      ],
      expected: [true, true],
    });
    const unassign = {
      version: 1,
      commandId: createId(),
      expected: { fixture: Number(fixture.version) },
      command: {
        type: 'unassign-judge',
        fixtureId: fixture.id,
        judgeId: fixture.tournament_judge_id,
      },
    };
    const removed = await send(as(world.bots.Director!), lobbyId, unassign);
    if (removed.kind !== 'accepted')
      throw new Error(`Unassignment refused: ${JSON.stringify(removed)}`);
    const replay = await send(as(world.bots.Director!), lobbyId, unassign);
    const after = await read();
    const [count] =
      await world.sql`select count(*)::int n from notifications where tab_command_id=${unassign.commandId} and kind='judge_unassigned'`;
    assert({
      given:
        'the same accepted unassignment retried after its version advances',
      should:
        'acknowledge once and expose only the current removal rather than a stale assignment or ready Room',
      actual: [
        replay.kind === 'accepted' && replay.receipt.replayed,
        count!.n,
        after.items.some(
          (item) => item.text === 'You have been unassigned from judging.',
        ),
        after.items.some(
          (item) =>
            item.text === 'You have been assigned to judge.' ||
            item.text === 'Your tournament Room is ready.',
        ),
      ],
      expected: [true, 1, true, false],
    });
    const assign = {
      version: 1,
      commandId: createId(),
      expected: { fixture: removed.receipt.resultingVersion },
      command: {
        type: 'assign-judge',
        fixtureId: fixture.id,
        judgeId: fixture.tournament_judge_id,
        chair: false,
        overrides: [],
      },
    };
    // Fails after the assignment notification, proving that even an outbox/inbox failure rolls back the panel and original receipt.
    const trigger = `notice_failure_${createId()}`;
    await world.sql.unsafe(
      `create function ${trigger}() returns trigger language plpgsql as $$ begin if NEW.kind='tournament_draw_changed' then raise exception 'controlled notification failure'; end if; return NEW; end $$`,
    );
    await world.sql.unsafe(
      `create trigger ${trigger} before insert on notifications for each row execute function ${trigger}()`,
    );
    const [beforeSignals] =
      await world.sql`select count(*)::int n from outbox where kind='user.notification-delivered'`;
    let failed = false;
    try {
      await send(as(world.bots.Director!), lobbyId, assign);
    } catch {
      failed = true;
    } finally {
      await world.sql.unsafe(`drop trigger ${trigger} on notifications`);
      await world.sql.unsafe(`drop function ${trigger}()`);
    }
    const [rolledBack] = await world.sql`select
      (select count(*)::int from fixture_judges where fixture_id=${fixture.id}) panel,
      (select count(*)::int from action_history where command_id=${assign.commandId}) receipts,
      (select count(*)::int from notifications where tab_command_id=${assign.commandId}) notices`;
    const [afterSignals] =
      await world.sql`select count(*)::int n from outbox where kind='user.notification-delivered'`;
    assert({
      given:
        'a notification write failing late in the actual assignment transaction',
      should: 'roll back the panel, receipt and all notification writes',
      actual: [
        failed,
        rolledBack!.panel,
        rolledBack!.receipts,
        rolledBack!.notices,
        afterSignals!.n - beforeSignals!.n,
      ],
      expected: [true, 0, 0, 0, 0],
    });
    const restored = await send(as(world.bots.Director!), lobbyId, assign);
    const again = await send(as(world.bots.Director!), lobbyId, assign);
    if (restored.kind !== 'accepted')
      throw new Error(`Assignment refused: ${JSON.stringify(restored)}`);
    const [assigned] =
      await world.sql`select count(*)::int n from notifications where tab_command_id=${assign.commandId} and kind='judge_assigned'`;
    const current = await read();
    assert({
      given:
        'the unchanged assignment retried after the failed transaction is gone',
      should:
        'commit once, keep replay stable and stop showing obsolete unassignment',
      actual: [
        again.kind === 'accepted' && again.receipt.replayed,
        assigned!.n,
        current.items.some(
          (item) => item.text === 'You have been assigned to judge.',
        ),
        current.items.some(
          (item) => item.text === 'You have been unassigned from judging.',
        ),
      ],
      expected: [true, 1, true, false],
    });
    await world.sql`update account_beta_access set state='revoked',revision=revision+1 where user_id=${fixture.user_id}`;
    const revoked = await read();
    await world.sql`update account_beta_access set state='approved',revision=revision+1 where user_id=${fixture.user_id}`;
    assert({
      given:
        'the same accepted tournament judge whose canonical beta access is revoked',
      should: 'lose all tournament inbox content and unread count immediately',
      actual: [revoked.items.length, revoked.unread],
      expected: [0, 0],
    });
  });
}

/** Judge changes on a draft draw tell nobody: publication is the one notice. */
export async function proveDraftJudgeChangesStaySilent(
  world: World,
): Promise<void> {
  const send = fixtureCommand({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const lobbyId = world.made.get('tournament-lobby')!;
  const [fixture] = await world.sql<
    { id: string; version: number; status: string; judge: string }[]
  >`select f.id,f.version,f.status,fj.tournament_judge_id judge from fixtures f
    join fixture_judges fj on fj.fixture_id=f.id
    where f.tab_round_id=${world.made.get('tab-round')!} order by f.id limit 1`;
  if (!fixture || fixture.status === 'published')
    throw new Error('A draft fixture with a judge is missing');
  const removed = await send(as(world.bots.Director!), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { fixture: Number(fixture.version) },
    command: {
      type: 'unassign-judge',
      fixtureId: fixture.id,
      judgeId: fixture.judge,
    },
  });
  if (removed.kind !== 'accepted')
    throw new Error(`draft unassignment refused: ${JSON.stringify(removed)}`);
  const restored = await send(as(world.bots.Director!), lobbyId, {
    version: 1,
    commandId: createId(),
    expected: { fixture: removed.receipt.resultingVersion },
    command: {
      type: 'assign-judge',
      fixtureId: fixture.id,
      judgeId: fixture.judge,
      chair: false,
      overrides: [],
    },
  });
  if (restored.kind !== 'accepted')
    throw new Error(`draft assignment refused: ${JSON.stringify(restored)}`);
  const [notices] =
    await world.sql`select count(*)::int n from notifications where notification_lobby_id=${lobbyId} and kind in ('judge_assigned','judge_replaced','judge_unassigned','tournament_draw_changed','tournament_room_ready')`;
  assert({
    given: 'a judge unassigned and assigned again on an unpublished draw',
    should: 'tell nobody before the draw is published',
    actual: notices!.n,
    expected: 0,
  });
}
