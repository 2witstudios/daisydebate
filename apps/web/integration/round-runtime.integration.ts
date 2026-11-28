import { winnerOutcome } from '@daisy/protocol/round-outcome';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';
import { pointsOfInformationSelection } from './foundation-selection.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('shared human commands run the engine with atomic refusals and recover lost responses', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId, operations, principal } = await launchRuntimeRound(
      f,
      room,
    );
    const round = await f.store.getRound(roundId);
    assert({
      given: 'a Room with nothing to run first, at Start round',
      should: 'create the Round active, from database time',
      actual: {
        version: round?.version,
        status: round?.status,
        started: round?.startedAt !== null,
      },
      expected: { version: 1, status: 'active', started: true },
    });
    const envelope = {
      version: 1 as const,
      commandId: createId(),
      expectedVersion: 1,
    };
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
            expectedVersion: 1,
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
          expectedVersion: 1,
          command: { type: 'yield', participantId: seat.id, sequence: 0 },
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
    await withRoomRuntime(async (f) => {
      let room = (await f.create()).view;
      const bot = (await f.operations.castChoices(f.host)).find(
        (p) => p.kind === 'bot' && p.aiRole === 'debater',
      )!;
      room = await f.seatBotOpponent(room, bot.actorId);
      const { roundId, operations, principal } = await launchRuntimeRound(
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
          outcome: winnerOutcome('affirmative'),
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
    }, botAdmissionForTests);
  });

test('two seats pressing on one point at once: one commits, the other is refused, and the clock alone returns the floor (INTX-14)', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble({ selection: pointsOfInformationSelection });
    const { roundId, operations, principal } = await launchRuntimeRound(
      f,
      room,
    );
    // The constructive opened 20 s ago, past its 10 s protected start.
    await f.sql`update rounds set started_at=clock_timestamp()-interval '20 seconds' where id=${roundId}`;
    await operations.tick(roundId);
    const live = (await f.store.getRound(roundId))!;
    const open = live.segments.find((s) => s.endedAt === null)!;
    const speaker = live.participants.find(
      (p) => p.actorId === f.host.actorId,
    )!;
    const offerer = live.participants.find(
      (p) => p.actorId === f.guest.actorId,
    )!;
    const guest = { kind: 'human' as const, actorId: f.guest.actorId };
    const press = (
      who: typeof principal,
      expectedVersion: number,
      command: Parameters<typeof operations.command>[2]['command'],
    ) =>
      operations.command(who, roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion,
        command,
      });
    const offered = await press(guest, live.version, {
      type: 'offer_poi',
      participantId: offerer.id,
      sequence: open.sequence,
    });
    const results = await Promise.allSettled([
      press(principal, offered.resultingVersion, {
        type: 'accept_poi',
        participantId: speaker.id,
        sequence: open.sequence,
        offererParticipantId: offerer.id,
      }),
      press(guest, offered.resultingVersion, {
        type: 'withdraw_poi',
        participantId: offerer.id,
        sequence: open.sequence,
      }),
    ]);
    const after = (await f.store.getRound(roundId))!;
    const point = after.checkpoint.point_of_information;
    assert({
      given: 'the speaker accepting and the offerer withdrawing at one version',
      should:
        'commit exactly one, refuse the other as a conflict, and leave the point as the winner made it',
      actual: {
        statuses: results.map((r) => r.status).sort(),
        refusal:
          results.find((r) => r.status === 'rejected')?.reason?.code ?? null,
        version: after.version,
        consistent:
          results[0].status === 'fulfilled'
            ? point.phase === 'speaking' &&
              point.holder_participant_id === offerer.id
            : point.phase === 'none',
      },
      expected: {
        statuses: ['fulfilled', 'rejected'],
        refusal: 'CONFLICT',
        version: offered.resultingVersion + 1,
        consistent: true,
      },
    });
    // Whichever won, the point is over within its 5 s, with no command.
    if (point.phase === 'none') {
      const again = await press(guest, after.version, {
        type: 'offer_poi',
        participantId: offerer.id,
        sequence: open.sequence,
      });
      await press(principal, again.resultingVersion, {
        type: 'accept_poi',
        participantId: speaker.id,
        sequence: open.sequence,
        offererParticipantId: offerer.id,
      });
    }
    const speaking = (await f.store.getRound(roundId))!.checkpoint
      .point_of_information;
    if (speaking.phase !== 'speaking') throw new Error('No point accepted');
    await Bun.sleep(5_500);
    await operations.tick(roundId);
    const returned = (await f.store.getRound(roundId))!;
    assert({
      given: 'a point accepted, then its 5 s run out and the Round ticked',
      should:
        'return the floor to the speaker with the speech still running',
      actual: {
        point: returned.checkpoint.point_of_information,
        open: returned.segments.find((s) => s.endedAt === null)?.id,
      },
      expected: { point: { phase: 'none' }, open: open.id },
    });
    await assertRejects({
      given: 'the holder’s End arriving after the clock returned the point',
      should:
        'refuse it as a conflict the round moved past, not an illegal move',
      actual: () =>
        press(guest, returned.version, {
          type: 'end_poi',
          participantId: offerer.id,
          sequence: open.sequence,
        }),
      code: 'CONFLICT',
    });
  });
});
