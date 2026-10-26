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

for (const revoke of ['lease', 'run'] as const)
  test(`bot commands bind the current worker and replay rechecks ${revoke} revocation`, async () => {
    await withRoomRuntime(
      async (f) => {
        let room = (await f.create()).view;
        const bot = (await f.operations.castChoices(f.host)).find(
          (p) => p.kind === 'bot',
        )!;
        room = await f.seatBotOpponent(room, bot.actorId);
        const { roundId, operations, principal } = await startRuntimeRound(
          f,
          room,
        );

        const round = (await f.store.getRound(roundId))!;
        const seat = round.participants.find((p) => p.actorId === bot.actorId)!;
        const runId = createId();
        await f.sql`update rounds set started_at=clock_timestamp()-interval '20 seconds' where id=${roundId}`;
        await operations.tick(roundId);
        const live = (await f.store.getRound(roundId))!;
        const segment = live.segments.find((s) => s.endedAt === null)!;
        const serviceId = `agent-run:${runId}`;
        const configuration = {
          roundId,
          roundParticipantId: seat.id,
          segmentId: segment.id,
          serviceId,
          publicationEpoch: 1,
        };
        // Storage setup only; production run creation belongs to the scoped worker.
        await f.sql`insert into agent_runs(id,round_participant_id,kind,model,provider,configuration_snapshot,started_at) values(${runId},${seat.id},'speech',null,'fixture',${configuration},clock_timestamp())`;
        await f.sql`insert into round_bot_publications(round_id,round_participant_id,segment_id,agent_run_id,service_id,publication_epoch,lease_token_digest,lease_expires_at) values(${roundId},${seat.id},${segment.id},${runId},${serviceId},1,${'a'.repeat(64)},clock_timestamp()+interval '1 minute')`;
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
          expectedVersion: live.version,
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
            version: live.version + 1,
            outcome: 'affirmative',
            actor: null,
            service: agent.serviceId,
          },
        });
        assert({
          given:
            'a terminal command replayed while its worker lease is still valid',
          should: 'recover its receipt without a new engine transition',
          actual: await operations.command(agent, roundId, envelope),
          expected: { ...receipt, replayed: true },
        });
        if (revoke === 'lease')
          await f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
        else
          await f.sql`update agent_runs set ended_at=clock_timestamp() where id=${runId}`;
        await assertRejects({
          given:
            revoke === 'lease'
              ? 'an unended run with an expired publication lease'
              : 'an ended run with an otherwise valid publication lease',
          should: 'refuse replay from the revoked worker',
          actual: () => operations.command(agent, roundId, envelope),
          code: 'AUTHORIZATION',
        });
      },
      { botBusyCap: 4 },
    );
  });
