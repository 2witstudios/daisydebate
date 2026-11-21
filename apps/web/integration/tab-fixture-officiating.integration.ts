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
import { createBots } from './tab-tournament.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
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
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      tournamentOwner: 'organization',
    });
    const parent = world.made.get('standing-lobby')!;
    const [minor, adult] = await owner<{ actor_id: string; user_id: string }[]>`
      select a.id as actor_id, a.user_id from room_participants p join actors a on a.id=p.actor_id
      where p.room_id=${world.roomId} and p.seat_kind='side' order by p.side
    `;
    const [guardian, coach] = await createBots(owner, [
      'Linked guardian',
      'Adult school coach',
    ]);
    const school = createId();
    await owner`insert into organizations (id,kind,name,handle,owner_user_id)
      values (${school},'school','Private Round school',${school},${coach!.userId})`;
    await owner`insert into memberships (organization_id,user_id,status,joined_at)
      values (${school},${adult!.user_id},'active',now())`;
    await owner`update account_age set birth_month=to_char(now()-interval '14 years','YYYY-MM')
      where user_id=${minor!.user_id}`;
    const link = createId();
    const consent = createId();
    await owner`insert into guardian_consent_evidence
      (id,person_user_id,role,method,notice_kind,notice_version,notice_digest,recorded_at)
      values (${consent},${guardian!.userId},'guardian','created-account','parental-consent','fixture',repeat('0',64),now())`;
    await owner`insert into guardian_links
      (id,guardian_user_id,minor_user_id,guardian_consent_id,status,activation,activated_at)
      values (${link},${guardian!.userId},${minor!.user_id},${consent},'active','created-account',now())`;
    await owner`insert into restriction_lobbies
      (guardian_link_id,guardian_user_id,minor_user_id,lobby_id,signed_at,waiver_version,waiver_digest)
      values (${link},${guardian!.userId},${minor!.user_id},${parent},now(),'fixture',repeat('0',64))`;
    const lobbyId = world.made.get('tournament-lobby')!,
      director = world.bots.Director!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const dependencies = {
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    };
    const setParentRule = async (ageRule: 'adults' | 'under-18') => {
      const [standing] = await owner<{ version: number; name: string }[]>`
        select version,name from lobbies where id=${parent}
      `;
      const edited = await lobbyAdministrationCommand(dependencies)(
        as(director),
        {
          version: 1,
          commandId: createId(),
          expected: { lobby: standing!.version },
          command: {
            type: 'edit-standing-lobby',
            organizationId: world.made.get('league')!,
            lobbyId: parent,
            name: standing!.name,
            ageRule,
          },
        },
      );
      if (edited.kind !== 'accepted')
        throw new Error(
          `Standing lobby edit refused: ${JSON.stringify(edited)}`,
        );
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
        const privacy = async () => ({
          youth: await f.store.readRoundYouth(roundId),
          reuseFenced: await f.store.readRoundReuseFenced(roundId),
          linked: (await f.store.readYouthRoundPeople(roundId)).debaters.map(
            ({ actorId, linkedAdultActorIds }) => ({
              actorId,
              linkedAdultActorIds,
            }),
          ),
        });
        const privacyBefore = await privacy();
        await setParentRule('under-18');
        const [frozen] =
          await owner`select standing_age_rule as rule, standing_youth_cast as youth
          from rounds where id=${roundId}`;
        const retainedPrivacy = {
          youth: true,
          reuseFenced: true,
          linked: [
            {
              actorId: minor!.actor_id,
              linkedAdultActorIds: [guardian!.actorId],
            },
          ],
        };
        assert({
          given:
            'a private mixed-cast Round started in Adults before the league switches the parent to Youth',
          should:
            'freeze the rule and retain the linked guardian audience without admitting the adult debater’s coach',
          actual: { before: privacyBefore, after: await privacy(), frozen },
          expected: {
            before: retainedPrivacy,
            after: retainedPrivacy,
            frozen: { rule: 'adults', youth: true },
          },
        });

        await setParentRule('adults');
        await owner`update guardian_links set status='ended', closed_at=now(), version=version+1 where id=${link}`;
        const deniedRestart = await deniedAsNotFound(() =>
          send(as(director), lobbyId, restart),
        );
        const [retained] =
          await owner`select f.room_id, r.status, count(v.round_id)::int as voids
          from fixtures f join rounds r on r.room_id=f.room_id
          left join round_source_voids v on v.round_id=r.id where f.id=${fixture!.id}
          group by f.room_id,r.status`;
        assert({
          given:
            'the accepted and started minor loses their only exact-lobby permission',
          should:
            'refuse the restart and retain the original source and fixture',
          actual: [deniedRestart, retained],
          expected: [
            true,
            { room_id: world.roomId, status: 'active', voids: 0 },
          ],
        });
        await owner`update account_age set birth_month=to_char(now()-interval '21 years','YYYY-MM')
          where user_id=${minor!.user_id}`;
        // A predecessor migration can mark a Youth Room in an otherwise
        // Open tournament. Seed that history in this disposable database.
        await owner.begin(async (tx) => {
          await tx`alter table rooms disable trigger rooms_lobby_immutable`;
          await tx`update rooms set legacy_tournament_youth=true where id=${world.roomId}`;
          await tx`set constraints all immediate`;
          await tx`alter table rooms enable trigger rooms_lobby_immutable`;
        });
        const restarted = await send(as(director), lobbyId, restart);
        const [replacement] =
          await owner`select room_id from fixtures where id=${fixture!.id}`;
        const [oldSource] =
          await owner`select r.status,v.command_id from rounds r join round_source_voids v on v.round_id=r.id where r.id=${roundId}`;
        const readiness = await owner<
          { readiness_command_id: string | null; readiness_version: number }[]
        >`select readiness_command_id,readiness_version from room_participants where room_id=${replacement!.room_id}`;
        const [pins] = await owner`select
          (a.rules_snapshot=b.rules_snapshot and a.config=b.config and a.execution_plan=b.execution_plan and a.template_id is not distinct from b.template_id and a.ballot_definition_id is not distinct from b.ballot_definition_id and a.ballot_definition_version is not distinct from b.ballot_definition_version) same,
          public.daisy_room_is_youth(b.id) as youth
          from rooms a join rooms b on b.id=${replacement!.room_id} where a.id=${world.roomId}`;
        assert({
          given: 'a real restart before a fixture result',
          should:
            'void the live source, preserve the old pins and youth privacy rule, and require every fresh Ready',
          actual: [
            restarted.kind,
            replacement!.room_id !== world.roomId,
            oldSource!.status,
            oldSource!.command_id,
            pins!.same,
            pins!.youth,
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
