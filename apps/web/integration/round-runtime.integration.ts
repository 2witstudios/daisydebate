import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('shared human commands run the engine with atomic refusals and recover lost responses', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId, operations, principal, envelope, receipt } =
      await startRuntimeRound(f, room);
    const round = await f.store.getRound(roundId);
    assert({
      given: 'the host starts a launched Round',
      should: 'persist the shared engine start from database time',
      actual: {
        version: receipt.resultingVersion,
        status: round?.status,
        started: round?.startedAt !== null,
      },
      expected: { version: 2, status: 'active', started: true },
    });
    const replay = await operations.command(principal, roundId, envelope);
    assert({
      given: 'a lost HTTP response followed by an identical retry',
      should: 'recover the original receipt',
      actual: replay,
      expected: { ...receipt, replayed: true },
    });
    const before = JSON.stringify(await f.store.getRound(roundId));
    const seat = round!.participants.find((p) => p.actorId === f.host.actorId)!;
    await assertRejects({
      given: 'an outsider naming the host seat',
      should: 'refuse the principal mismatch',
      actual: () =>
        operations.command(
          { kind: 'human', actorId: f.outsider.actorId },
          roundId,
          {
            ...envelope,
            commandId: createId(),
            expectedVersion: 2,
            command: { type: 'forfeit', participantId: seat.id },
          },
        ),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a yield without a live segment',
      should: 'refuse engine illegality atomically',
      actual: () =>
        operations.command(principal, roundId, {
          ...envelope,
          commandId: createId(),
          expectedVersion: 2,
          command: { type: 'yield', participantId: seat.id },
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'authority and engine refusals',
      should: 'leave durable runtime and segment rows unchanged',
      actual: JSON.stringify(await f.store.getRound(roundId)),
      expected: before,
    });
  });
});

test('bot commands bind the active AgentRun to its own seat and replay rechecks run revocation', async () => {
  await withRoomRuntime(async (f) => {
    let room = (await f.create()).view;
    const bot = (await f.operations.castChoices(f.host)).find(
      (p) => p.kind === 'bot',
    )!;
    room = (
      await f.command(f.host, room, {
        type: 'claim-seat',
        role: 'affirmative',
        slot: 0,
      })
    ).view;
    room = (
      await f.command(f.host, room, {
        type: 'assign-seat',
        actorId: bot.actorId,
        role: 'negative',
        slot: 0,
      })
    ).view;
    room = (await f.consent(f.host, room, 'ready')).view;
    const { roundId, operations, principal } = await startRuntimeRound(f, room);

    const round = (await f.store.getRound(roundId))!;
    const seat = round.participants.find((p) => p.actorId === bot.actorId)!;
    const runId = createId();
    await f.store.recordAgentRun({
      id: runId,
      roundParticipantId: seat.id,
      kind: 'speech',
      model: null,
      provider: 'fixture',
    });
    const agent = {
      kind: 'agent' as const,
      serviceId: `agent-run:${runId}`,
      agentRunId: runId,
      roundId,
      participantId: seat.id,
    };
    const envelope = {
      version: 1 as const,
      commandId: createId(),
      expectedVersion: 2,
      command: { type: 'forfeit' as const, participantId: seat.id },
    };
    await assertRejects({
      given: 'a host session naming a bot seat',
      should: 'refuse human impersonation',
      actual: () => operations.command(principal, roundId, envelope),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'the right run with an unscoped service name',
      should: 'refuse forged service identity',
      actual: () =>
        operations.command(
          { ...agent, serviceId: 'worker' },
          roundId,
          envelope,
        ),
      code: 'AUTHORIZATION',
    });
    const receipt = await operations.command(agent, roundId, envelope);
    const [audit] =
      await f.sql`select actor_id,service_id from round_commands where command_id=${envelope.commandId}`;
    assert({
      given: 'a correctly scoped active AgentRun',
      should: 'execute through the same engine and attribute service only',
      actual: {
        version: receipt.resultingVersion,
        outcome: (await f.store.getRound(roundId))?.outcome,
        actor: audit.actor_id,
        service: audit.service_id,
      },
      expected: {
        version: 3,
        outcome: 'affirmative',
        actor: null,
        service: agent.serviceId,
      },
    });
    await f.sql`update agent_runs set ended_at=clock_timestamp() where id=${runId}`;
    await assertRejects({
      given: 'the accepted command retried after its run ends',
      should: 'reauthorize and refuse replay without changing state',
      actual: () => operations.command(agent, roundId, envelope),
      code: 'AUTHORIZATION',
    });
  });
});
