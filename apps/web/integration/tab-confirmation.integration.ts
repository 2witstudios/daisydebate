import { instantMs } from '@daisy/clock';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
  finishedOrBlockedBehind,
} from '@daisy/db/testing';
import { createTabStore, createConfirmationCommandStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { registerFixtureJudge } from './tab-fixture-judge.test-support';
import {
  as,
  presetStaffRoleId,
} from './tab-tournament-organization-wiring.test-support';
import type { Bot } from './tab-tournament.test-support';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { fixtureCommand } from '../src/features/tab/operations/fixture-command';
import { settlePendingCommand } from '../src/features/tab/operations/confirmation-command';
import { CommandDenied } from '../src/features/tab/commands/run-command';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual pending confirmations preserve five-minute issuance, settle once and recheck expiry, versions and both principals after locks', async () => {
  const scratch = scratchDatabase(databaseUrl, 'tabconfirmation');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 1 }),
    observer = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', { noPrep: true });
    const director = world.bots.Director!,
      lobbyId = world.made.get('tournament-lobby')!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const send = fixtureCommand({
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    });
    const settle = settlePendingCommand({ store, authorize, newId: createId });
    const organization = organizationCommand({
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    });
    const grant = async (person: Bot) => {
      const [lobby] =
        await owner`select version from lobbies where id=${lobbyId}`;
      const answer = await organization(as(director), {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(lobby!.version) },
        command: {
          type: 'give-grant',
          scope: { kind: 'lobby', lobbyId },
          userId: person.userId,
          roleId: presetStaffRoleId,
          expiresAt: null,
        },
      });
      if (answer.kind !== 'accepted')
        throw new Error('Actual lobby Staff grant refused');
      const [row] = await owner<
        { id: string }[]
      >`select id from grants where lobby_id=${lobbyId} and user_id=${person.userId} and revoked_at is null order by granted_at desc limit 1`;
      return row!.id;
    };
    const [fixture] =
      await owner`select f.id,f.version,j.id judge_id,j.actor_id from fixtures f join fixture_judges fj on fj.fixture_id=f.id join tournament_judges j on j.id=fj.tournament_judge_id where f.room_id=${world.roomId}`;
    const originalPerson = Object.values(world.bots).find(
      (person) => person.actorId === fixture!.actor_id,
    )!;
    const nextPerson = world.bots['Judge C']!;
    const nextJudge = await registerFixtureJudge({
      owner,
      store,
      world,
      person: nextPerson,
    });
    await grant(originalPerson);
    const propose = async (
      person: Bot,
      outJudgeId: string,
      inJudgeId: string,
    ) => {
      const [current] =
        await owner`select version from fixtures where id=${fixture!.id}`;
      const envelope = {
        version: 1,
        commandId: createId(),
        expected: { fixture: Number(current!.version) },
        command: {
          type: 'replace-judge',
          fixtureId: String(fixture!.id),
          outJudgeId,
          inJudgeId,
          overrides: [],
        },
      };
      const answer = await send(as(person), lobbyId, envelope);
      if (answer.kind !== 'pending')
        throw new Error(
          `Connected official proposal was not held: ${JSON.stringify(answer)}`,
        );
      return { person, envelope, answer };
    };
    const request = (pendingCommandId: string, type = 'confirm-command') => ({
      version: 1,
      commandId: createId(),
      expected: {},
      command: { type, pendingCommandId },
    });
    const first = await propose(
      originalPerson,
      String(fixture!.judge_id),
      nextJudge.id,
    );
    const [issued] = await owner<
      { created_at: Date; expires_at: Date; status: string }[]
    >`select created_at,expires_at,status from pending_commands where command_id=${first.envelope.commandId}`;
    const repeat = await send(as(originalPerson), lobbyId, first.envelope);
    assert({
      given:
        'an actual connected Staff official proposing and replaying the same command',
      should:
        'persist one server-issued five-minute deadline with no ordinary mutation or accepted history',
      actual: [
        issued!.expires_at.getTime() - issued!.created_at.getTime(),
        issued!.status,
        repeat,
        (await owner`select version from fixtures where id=${fixture!.id}`)[0]!
          .version,
        (
          await owner`select count(*)::int n from action_history where command_id=${first.envelope.commandId}`
        )[0]!.n,
      ],
      expected: [300_000, 'pending', first.answer, fixture!.version, 0],
    });
    let selfDenied = false,
      strangerDenied = false,
      foreignDenied = false;
    try {
      await settle(
        as(originalPerson),
        lobbyId,
        request(first.envelope.commandId),
      );
    } catch (error) {
      if (!(error instanceof CommandDenied)) throw error;
      selfDenied = true;
    }
    try {
      await settle(
        as(world.bots.Coach!),
        lobbyId,
        request(first.envelope.commandId),
      );
    } catch (error) {
      if (!(error instanceof CommandDenied)) throw error;
      strangerDenied = true;
    }
    try {
      await settle(
        as(director),
        world.made.get('standing-lobby')!,
        request(first.envelope.commandId),
      );
    } catch (error) {
      if (!(error instanceof CommandDenied)) throw error;
      foreignDenied = true;
    }
    assert({
      given:
        'self-confirmation, an unqualified confirmer and a foreign tenant address',
      should: 'refuse all three without settling the real proposal',
      actual: [
        selfDenied,
        strangerDenied,
        foreignDenied,
        (
          await owner`select status from pending_commands where command_id=${first.envelope.commandId}`
        )[0]!.status,
      ],
      expected: [true, true, true, 'pending'],
    });
    const confirmation = request(first.envelope.commandId);
    const rollback = createAppError(
      'INVARIANT',
      'Controlled confirmation rollback',
    );
    const failing = settlePendingCommand({
      authorize,
      newId: createId,
      store: {
        confirmationCommand: (input, work) =>
          store.confirmationCommand(input, (session) =>
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
      await failing(as(director), lobbyId, confirmation);
    } catch (error) {
      if (error !== rollback) throw error;
      rolledBack = true;
    }
    assert({
      given:
        'real settlement, proposer/confirmer journals and ordinary Room writes followed by injected failure',
      should: 'roll back all effects so the same confirmation can retry',
      actual: [
        rolledBack,
        (
          await owner`select status from pending_commands where command_id=${first.envelope.commandId}`
        )[0]!.status,
        (await owner`select version from fixtures where id=${fixture!.id}`)[0]!
          .version,
        (
          await owner`select count(*)::int n from action_history where command_id in (${first.envelope.commandId},${confirmation.commandId})`
        )[0]!.n,
      ],
      expected: [true, 'pending', fixture!.version, 0],
    });
    const confirmed = await settle(as(director), lobbyId, confirmation);
    const replay = await settle(as(director), lobbyId, confirmation);
    const originalReplay = await send(
      as(originalPerson),
      lobbyId,
      first.envelope,
    );
    const [originalHistory] =
      await owner`select actor_user_id,confirmed_by_user_id,command_id from action_history where command_id=${first.envelope.commandId}`;
    assert({
      given:
        'a qualified different official confirming the unchanged proposal and both principals replaying',
      should:
        'apply once, preserve both receipt identities and name the actual proposer and confirmer',
      actual: [
        confirmed.kind,
        replay.kind === 'accepted' && replay.receipt.replayed,
        originalReplay.kind === 'accepted' && originalReplay.receipt.commandId,
        originalHistory!.actor_user_id,
        originalHistory!.confirmed_by_user_id,
        (
          await owner`select status from pending_commands where command_id=${first.envelope.commandId}`
        )[0]!.status,
      ],
      expected: [
        'accepted',
        true,
        first.envelope.commandId,
        originalPerson.userId,
        director.userId,
        'confirmed',
      ],
    });
    const nextGrantId = await grant(nextPerson);
    const withdrawn = await propose(
      nextPerson,
      nextJudge.id,
      String(fixture!.judge_id),
    );
    const withdrawal = await settle(
      as(nextPerson),
      lobbyId,
      request(withdrawn.envelope.commandId, 'withdraw-command'),
    );
    const closedReplay = await send(
      as(nextPerson),
      lobbyId,
      withdrawn.envelope,
    );
    assert({
      given:
        'the proposer withdrawing a held command and retrying the original proposal',
      should:
        'retain its withdrawn state and original deadline instead of reopening it',
      actual: [withdrawal.kind, closedReplay],
      expected: [
        'accepted',
        {
          kind: 'settled',
          pendingCommandId: withdrawn.envelope.commandId,
          status: 'withdrawn',
          expiresAt: withdrawn.answer.expiresAt,
        },
      ],
    });

    // Only the trusted confirmation clock is controlled here. Issuance, locks,
    // account/source facts, policy duration and all storage remain real.
    const expired = await propose(
      nextPerson,
      nextJudge.id,
      String(fixture!.judge_id),
    );
    const deadline = instantMs(expired.answer.expiresAt);
    let checkedAt = deadline;
    const controlledStore = createConfirmationCommandStore(
      committingRuntimeTestDatabase(observer),
      async () => new Date(checkedAt),
    );
    const controlled = settlePendingCommand({
      store: controlledStore,
      authorize,
      newId: createId,
    });
    const atId = request(expired.envelope.commandId),
      afterId = request(expired.envelope.commandId);
    const at = await controlled(as(director), lobbyId, atId);
    checkedAt = deadline + 1;
    const after = await controlled(as(director), lobbyId, afterId);
    assert({
      given:
        'the canonical persisted deadline at the exact boundary and one millisecond after under a trusted clock',
      should: 'refuse both without a settlement, ordinary mutation or receipt',
      actual: [
        at,
        after,
        (
          await owner`select status from pending_commands where command_id=${expired.envelope.commandId}`
        )[0]!.status,
        (
          await owner`select count(*)::int n from action_history where command_id in (${atId.commandId},${afterId.commandId},${expired.envelope.commandId})`
        )[0]!.n,
      ],
      expected: [
        { kind: 'refused', refusal: 'pending-expired' },
        { kind: 'refused', refusal: 'pending-expired' },
        'pending',
        0,
      ],
    });
    const decline = await controlled(
      as(director),
      lobbyId,
      request(expired.envelope.commandId, 'decline-command'),
    );
    assert({
      given: 'the same expired proposal',
      should: 'allow qualified decline to settle without applying it',
      actual: [
        decline.kind,
        (
          await owner`select status from pending_commands where command_id=${expired.envelope.commandId}`
        )[0]!.status,
      ],
      expected: ['accepted', 'declined'],
    });

    const waiting = await propose(
      nextPerson,
      nextJudge.id,
      String(fixture!.judge_id),
    );
    let time = instantMs(waiting.answer.expiresAt) - 1,
      reads = 0;
    const waitingStore = createConfirmationCommandStore(
      committingRuntimeTestDatabase(observer),
      async () => {
        reads++;
        return new Date(time);
      },
    );
    const waitingConfirm = settlePendingCommand({
      store: waitingStore,
      authorize,
      newId: createId,
    });
    const waitEnvelope = request(waiting.envelope.commandId);
    const held = await owner.begin(async (tx) => {
      await tx`select command_id from pending_commands where command_id=${waiting.envelope.commandId} for update`;
      const [backend] = await tx`select pg_backend_pid() pid`;
      const result = waitingConfirm(as(director), lobbyId, waitEnvelope);
      const blocked = await finishedOrBlockedBehind(
        result,
        observer,
        Number(backend!.pid),
        { now: Date.now },
      );
      assert({
        given:
          'the actual pending row locked while a confirmation starts just before its deadline',
        should:
          'reach the real lock wait before sampling confirmation authority time',
        actual: [blocked, reads],
        expected: ['blocked', 0],
      });
      time = instantMs(waiting.answer.expiresAt) + 1;
      return { result };
    });
    const crossed = await held.result;
    assert({
      given: 'authoritative time crossing expiry during that actual row wait',
      should:
        'sample after the wait and refuse with no applied proposal or receipt',
      actual: [
        crossed,
        reads,
        (
          await owner`select status from pending_commands where command_id=${waiting.envelope.commandId}`
        )[0]!.status,
        (
          await owner`select count(*)::int n from action_history where command_id in (${waiting.envelope.commandId},${waitEnvelope.commandId})`
        )[0]!.n,
      ],
      expected: [
        { kind: 'refused', refusal: 'pending-expired' },
        1,
        'pending',
        0,
      ],
    });
    await waitingConfirm(
      as(nextPerson),
      lobbyId,
      request(waiting.envelope.commandId, 'withdraw-command'),
    );
    const revoked = await propose(
      nextPerson,
      nextJudge.id,
      String(fixture!.judge_id),
    );
    const [lobbyBeforeRevoke] =
      await owner`select version from lobbies where id=${lobbyId}`;
    const revocation = await organization(as(director), {
      version: 1,
      commandId: createId(),
      expected: { lobby: Number(lobbyBeforeRevoke!.version) },
      command: {
        type: 'remove-grant',
        scope: { kind: 'lobby', lobbyId },
        grantId: nextGrantId,
      },
    });
    if (revocation.kind !== 'accepted')
      throw new Error('Actual proposer grant revocation refused');
    const revokedConfirmId = request(revoked.envelope.commandId);
    const revokedConfirm = await settle(
      as(director),
      lobbyId,
      revokedConfirmId,
    );
    const revokedWithdrawal = await settle(
      as(nextPerson),
      lobbyId,
      request(revoked.envelope.commandId, 'withdraw-command'),
    );
    assert({
      given: 'the proposing official loses its real grant after issuance',
      should:
        'refuse confirmation without effects while preserving the proposer cleanup exit',
      actual: [
        revokedConfirm,
        revokedWithdrawal.kind,
        (
          await owner`select count(*)::int n from action_history where command_id in (${revoked.envelope.commandId},${revokedConfirmId.commandId})`
        )[0]!.n,
      ],
      expected: [
        { kind: 'refused', refusal: 'proposer-unauthorized' },
        'accepted',
        0,
      ],
    });
    await grant(nextPerson);
    const stale = await propose(
      nextPerson,
      nextJudge.id,
      String(fixture!.judge_id),
    );
    const direct = await send(as(director), lobbyId, {
      ...stale.envelope,
      commandId: createId(),
    });
    if (direct.kind !== 'accepted')
      throw new Error('Actual intervening fixture edit refused');
    const staleConfirmId = request(stale.envelope.commandId);
    const staleConfirm = await settle(as(director), lobbyId, staleConfirmId);
    assert({
      given: 'an actual fixture mutation between proposal and confirmation',
      should:
        'rerun against current versions and refuse without a stale proposal receipt',
      actual: [
        staleConfirm,
        (
          await owner`select count(*)::int n from action_history where command_id in (${stale.envelope.commandId},${staleConfirmId.commandId})`
        )[0]!.n,
      ],
      expected: [{ kind: 'refused', refusal: 'version-conflict' }, 0],
    });
    await settle(
      as(nextPerson),
      lobbyId,
      request(stale.envelope.commandId, 'withdraw-command'),
    );

    await grant(world.bots.Staff!);
    const raced = await propose(
      originalPerson,
      String(fixture!.judge_id),
      nextJudge.id,
    );
    const raceStore = createConfirmationCommandStore(
      committingRuntimeTestDatabase(observer),
    );
    const raceSettle = settlePendingCommand({
      store: raceStore,
      authorize,
      newId: createId,
    });
    const raceEnvelopes = [
      request(raced.envelope.commandId),
      request(raced.envelope.commandId),
    ];
    const race = await Promise.all([
      raceSettle(as(director), lobbyId, raceEnvelopes[0]),
      raceSettle(as(world.bots.Staff!), lobbyId, raceEnvelopes[1]),
    ]);
    assert({
      given:
        'two actual qualified nonconflicted officials confirming one unchanged proposal concurrently',
      should:
        'serialize one confirmation and one pending-settled refusal, with one original receipt and one confirmer receipt',
      actual: [
        race.map((answer) => answer.kind).sort(),
        race.find((answer) => answer.kind === 'refused'),
        (
          await owner`select status from pending_commands where command_id=${raced.envelope.commandId}`
        )[0]!.status,
        (
          await owner`select count(*)::int n from action_history where command_id=${raced.envelope.commandId}`
        )[0]!.n,
        (
          await owner`select count(*)::int n from action_history where command_id in (${raceEnvelopes[0]!.commandId},${raceEnvelopes[1]!.commandId})`
        )[0]!.n,
      ],
      expected: [
        ['accepted', 'refused'],
        { kind: 'refused', refusal: 'pending-settled' },
        'confirmed',
        1,
        1,
      ],
    });
  } finally {
    await owner.close();
    await observer.close();
    await scratch.drop();
  }
}, 90_000);
