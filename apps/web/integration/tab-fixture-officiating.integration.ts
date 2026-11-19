import { noLinkedAdults } from '../src/features/spectating/linked-adults';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { fixtureCommand } from '../src/features/tab/operations/fixture-command';
import { registerFixtureJudge } from './tab-fixture-judge.test-support';
import { isAppError } from '@daisy/errors';
import { roundViewReader } from '../src/features/round-runtime/reads';
import { CommandDenied } from '../src/features/tab/commands/run-command';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual fixture officiating replaces unsubmitted ordinary identities, replays, rolls back and restarts with exact pins and no Ready', async () => {
  const scratch = scratchDatabase(databaseUrl, 'fixtureofficiating');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', { noPrep: true });
    const lobbyId = world.made.get('tournament-lobby')!,
      director = world.bots.Director!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const dependencies = {
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    };
    const send = fixtureCommand(dependencies);
    const [fixture] =
      await owner`select * from fixtures where room_id=${world.roomId}`;
    const [oldJudge] =
      await owner`select j.id,j.actor_id,p.id participant_id from fixture_judges fj join tournament_judges j on j.id=fj.tournament_judge_id join room_participants p on p.actor_id=j.actor_id and p.room_id=${world.roomId} where fj.fixture_id=${fixture!.id}`;
    const sparePerson = world.bots['Judge C']!;
    const spare = await registerFixtureJudge({
      owner,
      store,
      world,
      person: sparePerson,
    });
    const envelope = {
      version: 1,
      commandId: createId(),
      expected: { fixture: Number(fixture!.version) },
      command: {
        type: 'replace-judge',
        fixtureId: String(fixture!.id),
        outJudgeId: String(oldJudge!.id),
        inJudgeId: String(spare.id),
        overrides: [],
      },
    };
    let denied = false;
    try {
      await send(as(world.bots.Coach!), lobbyId, envelope);
    } catch (error) {
      if (!(error instanceof CommandDenied)) throw error;
      denied = true;
    }
    const [booked] =
      await owner`select j.id from tournament_judges j join fixture_judges fj on fj.tournament_judge_id=j.id join fixtures f on f.id=fj.fixture_id where j.lobby_id=${lobbyId} and f.id<>${fixture!.id} and f.status='published' limit 1`;
    const collisionId = createId();
    const collision = await send(as(director), lobbyId, {
      ...envelope,
      commandId: collisionId,
      command: { ...envelope.command, inJudgeId: String(booked!.id) },
    });
    let foreignDenied = false;
    try {
      await send(as(director), world.made.get('standing-lobby')!, envelope);
    } catch (error) {
      if (!(error instanceof CommandDenied)) throw error;
      foreignDenied = true;
    }
    assert({
      given:
        'an actual person booked in the sibling fixture and a foreign lobby address',
      should: 'refuse both without a fixture mutation or journal entry',
      actual: [
        collision,
        foreignDenied,
        (
          await owner`select count(*)::int n from action_history where command_id=${collisionId}`
        )[0]!.n,
      ],
      expected: [{ kind: 'refused', refusal: 'judge-double-booked' }, true, 0],
    });
    await withRoomRuntime(
      async (f) => {
        const cast = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
        for (const person of cast) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, world.roomId),
            'ready',
          );
        }
      },
      { databaseUrl: scratch.url },
    );
    await owner.begin(async (tx) => {
      await tx`select * from public.daisy_authorization_accounts_v2(array[${sparePerson.actorId}]::text[],null::text,true)`;
      await tx`update account_beta_access set state='pending',decided_at=null,revision=revision+1 where user_id=${sparePerson.userId}`;
    });
    let eligibilityDenied = false;
    try {
      await send(as(director), lobbyId, envelope);
    } catch (error) {
      if (!(error instanceof CommandDenied)) throw error;
      eligibilityDenied = true;
    }
    assert({
      given:
        'the accepted spare judge loses canonical beta admission while retaining registration',
      should:
        'refuse the new ordinary assignment without recording the command',
      actual: [
        eligibilityDenied,
        (
          await owner`select count(*)::int n from action_history where command_id=${envelope.commandId}`
        )[0]!.n,
      ],
      expected: [true, 0],
    });
    await owner.begin(async (tx) => {
      await tx`select * from public.daisy_authorization_accounts_v2(array[${sparePerson.actorId}]::text[],null::text,true)`;
      await tx`update account_beta_access set state='approved',decided_at=clock_timestamp(),revision=revision+1 where user_id=${sparePerson.userId}`;
    });
    const replaced = await send(as(director), lobbyId, envelope);
    const replay = await send(as(director), lobbyId, envelope);
    const bodyConflict = await send(as(director), lobbyId, {
      ...envelope,
      command: { ...envelope.command, inJudgeId: String(booked!.id) },
    });
    assert({
      given: 'the accepted command id reused with a different requested judge',
      should: 'refuse the changed body rather than replay or mutate it',
      actual: bodyConflict,
      expected: { kind: 'refused', refusal: 'command-conflict' },
    });
    const [newJudge] =
      await owner`select id,readiness_command_id,readiness_version from room_participants where room_id=${world.roomId} and actor_id=${spare.actor_id}`;
    assert({
      given: 'an actual published fixture before Start and its ordinary Room',
      should:
        'deny a nonofficial, replace only the judge identity once and mint no Ready consent',
      actual: [
        denied,
        replaced.kind,
        replay,
        newJudge!.id !== oldJudge!.participant_id,
        newJudge!.readiness_command_id,
        newJudge!.readiness_version,
      ],
      expected: [
        true,
        'accepted',
        replaced.kind === 'accepted'
          ? { ...replaced, receipt: { ...replaced.receipt, replayed: true } }
          : replaced,
        true,
        null,
        0,
      ],
    });
    assert({
      given:
        'an ordinary open Room whose original cast all consented before its judge changed',
      should: 'invalidate every old Ready consent after the real edit',
      actual: (
        await owner<
          { readiness_command_id: string | null }[]
        >`select readiness_command_id from room_participants where room_id=${world.roomId}`
      ).every((person) => person.readiness_command_id === null),
      expected: true,
    });
    await withRoomRuntime(
      async (f) => {
        const cast = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
        for (const person of cast) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, world.roomId),
            'ready',
          );
        }
        const room = await f.operations.view(director, world.roomId);
        const started = await f.operations.command(director, world.roomId, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: room.version,
        });
        const roundId = started.receipt.roundRef!.id;
        const [before] =
          await owner`select version from fixtures where id=${fixture!.id}`;
        const remove = {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(before!.version) },
          command: {
            type: 'unassign-judge',
            fixtureId: String(fixture!.id),
            judgeId: String(spare.id),
          },
        };
        const rollback = new Error('Controlled fixture transaction rollback');
        const fail = fixtureCommand({
          ...dependencies,
          store: {
            fixtureCommand: (input, work) =>
              store.fixtureCommand(input, (session) =>
                work({
                  ...session,
                  apply: async (...args) => {
                    await session.apply(...args);
                    throw rollback;
                  },
                }),
              ),
          },
        });
        let rolledBack = false;
        try {
          await fail(as(director), lobbyId, remove);
        } catch (error) {
          if (error !== rollback) throw error;
          rolledBack = true;
        }
        const [untouched] =
          await owner`select s.current_version,s.participant_id,f.version fixture_version,(select count(*)::int from action_history where command_id=${remove.commandId}) history,(select count(*)::int from round_commands where command_id=${remove.commandId}) commands from round_judge_slots s join fixtures f on f.id=${fixture!.id} where s.round_id=${roundId}`;
        assert({
          given:
            'actual ordinary assignment and fixture/history writes followed by controlled failure',
          should:
            'roll back every lineage/pointer/receipt effect before the same command is retried',
          actual: [
            rolledBack,
            untouched!.current_version,
            untouched!.participant_id,
            Number(untouched!.fixture_version),
            untouched!.history,
            untouched!.commands,
          ],
          expected: [true, 1, newJudge!.id, Number(before!.version), 0, 0],
        });
        const removed = await send(as(director), lobbyId, remove);
        const [slot] =
          await owner`select current_version,participant_id,actor_id from round_judge_slots where round_id=${roundId}`;
        const identities =
          await owner`select id,actor_id from round_participants where round_id=${roundId} and seat_kind='judge'`;
        assert({
          given: 'the genuinely started Round and an unsubmitted judge',
          should:
            'retain its immutable identity and frozen slot while retiring current authority',
          actual: [
            removed.kind,
            identities,
            slot!.current_version,
            slot!.participant_id,
            slot!.actor_id,
          ],
          expected: [
            'accepted',
            [{ id: newJudge!.id, actor_id: spare.actor_id }],
            2,
            null,
            null,
          ],
        });
        let retiredReadDenied = false;
        try {
          await roundViewReader(f.store, noLinkedAdults)(sparePerson, roundId);
        } catch (error) {
          if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
          retiredReadDenied = true;
        }
        assert({
          given: 'the retired human after the assignment transaction commits',
          should:
            'lose the actual ordinary Round read while the official can still read the same source',
          actual: [
            retiredReadDenied,
            (await roundViewReader(f.store, noLinkedAdults)(director, roundId))
              .id,
          ],
          expected: [true, roundId],
        });
        const [after] =
          await owner`select version from fixtures where id=${fixture!.id}`;
        const restore = {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(after!.version) },
          command: {
            type: 'assign-judge',
            fixtureId: String(fixture!.id),
            judgeId: String(oldJudge!.id),
            chair: true,
            overrides: [],
          },
        };
        const race = await Promise.all([
          send(as(director), lobbyId, restore),
          send(as(director), lobbyId, { ...restore, commandId: createId() }),
        ]);
        const restored = race.find((answer) => answer.kind === 'accepted')!;
        assert({
          given:
            'two actual concurrent assignments against the same empty-slot fixture version',
          should: 'serialize one acceptance and one version refusal',
          actual: race.map((answer) => answer.kind).sort(),
          expected: ['accepted', 'refused'],
        });
        const [current] =
          await owner`select current_version,participant_id,actor_id from round_judge_slots where round_id=${roundId}`;
        const sourceCounts = await store.hostRound(
          {
            viewerUserId: director.userId,
            lobbyId,
            eventId: world.made.get('event')!,
            tabRoundId: world.made.get('tab-round')!,
          },
          async (facts) =>
            facts
              ? {
                  slots: facts.judgeSlots.filter(
                    (row) => row.roundId === roundId,
                  ).length,
                }
              : null,
        );
        const [retainedJudgeIdentities] = await owner<
          { n: number }[]
        >`select count(*)::int n from round_participants where round_id=${roundId} and seat_kind='judge'`;
        assert({
          given:
            'a real emptied and reassigned frozen judge slot with retained assignment identities',
          should:
            'give the host read one ballot obligation from the frozen slot rather than counting retired people as more seats',
          actual: [
            sourceCounts?.slots,
            Number(retainedJudgeIdentities!.n) > (sourceCounts?.slots ?? 0),
          ],
          expected: [1, true],
        });
        assert({
          given: 'an empty frozen slot',
          should:
            'append a fresh assignment identity rather than resurrect the retired Start participant',
          actual: [
            restored.kind,
            current!.current_version,
            current!.actor_id,
            current!.participant_id !== oldJudge!.participant_id,
            current!.participant_id !== newJudge!.id,
          ],
          expected: ['accepted', 3, oldJudge!.actor_id, true, true],
        });
        const [next] =
          await owner`select version from fixtures where id=${fixture!.id}`;
        const restart = {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(next!.version) },
          command: {
            type: 'restart-fixture',
            fixtureId: String(fixture!.id),
            reason: 'Actual official restart',
          },
        };
        const restarted = await send(as(director), lobbyId, restart);
        const [replacement] =
          await owner`select room_id from fixtures where id=${fixture!.id}`;
        const [oldSource] =
          await owner`select r.status,v.command_id from rounds r join round_source_voids v on v.round_id=r.id where r.id=${roundId}`;
        const readiness = await owner<
          { readiness_command_id: string | null; readiness_version: number }[]
        >`select readiness_command_id,readiness_version from room_participants where room_id=${replacement!.room_id}`;
        const [pins] =
          await owner`select (a.rules_snapshot=b.rules_snapshot and a.config=b.config and a.execution_plan=b.execution_plan and a.template_id is not distinct from b.template_id and a.ballot_definition_id is not distinct from b.ballot_definition_id and a.ballot_definition_version is not distinct from b.ballot_definition_version) same from rooms a join rooms b on b.id=${replacement!.room_id} where a.id=${world.roomId}`;
        assert({
          given: 'a real restart before a fixture result',
          should:
            'ordinary-stop and explicitly void the live source, keep its history, assemble exact pins and require every fresh Ready',
          actual: [
            restarted.kind,
            replacement!.room_id !== world.roomId,
            oldSource!.status,
            oldSource!.command_id,
            pins!.same,
            readiness.length,
            readiness.every(
              (row) =>
                row.readiness_command_id === null &&
                row.readiness_version === 0,
            ),
          ],
          expected: [
            'accepted',
            true,
            'abandoned',
            restart.commandId,
            true,
            cast.length,
            true,
          ],
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
