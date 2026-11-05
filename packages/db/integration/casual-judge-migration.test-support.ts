import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { agentLeaseDigest } from '../src/round-agent-lease';
import { admissionSponsor } from './bot-admission.test-support';
import { createBotSeat } from './bot-seat.test-support';
import { validRules } from './round-fixtures';
import type { Fixture } from './constraint-helpers';

export const originalAdmission = '2026-10-31T23:59:58.000Z';
export const originalDispatch = '2026-11-01T00:00:01.000Z';
export const originalAnswer = '2026-11-01T00:00:02.000Z';
export const judgeCases = [
  'reserved',
  'terminal_undispatched',
  'unknown',
  'live_received',
  'failed_unrestored',
  'failed_retryable',
  'invalid_received',
  'invalid_unknown',
  'host_changed',
  'reconstructed',
  'legacy_failed',
  'mixed',
  'uncorroborated_failed',
  'deadline_only',
  'late_unknown',
  'missing_attempt',
  'erased',
  'ranked',
  'human',
  'service',
  'existing',
] as const;
export type JudgeCase = (typeof judgeCases)[number];

/** Real predecessor rows; claim/start time deliberately precedes actual dispatch. */
export async function seedHistoricalJudge(f: Fixture, mode: JudgeCase) {
  const terminal = [
    'terminal_undispatched',
    'failed_unrestored',
    'invalid_received',
    'invalid_unknown',
    'reconstructed',
    'legacy_failed',
    'mixed',
    'uncorroborated_failed',
    'deadline_only',
    'late_unknown',
    'missing_attempt',
  ].includes(mode);
  const roundId = await f.round({
    created_at: new Date(originalAdmission),
    rules_snapshot: { ...validRules, seats: { ...validRules.seats, judge: 1 } },
    status: terminal ? 'abandoned' : 'active',
    current_stage: terminal ? null : 'live',
    started_at: new Date(originalAdmission),
    completed_at: terminal ? new Date(originalDispatch) : null,
  });
  try {
    const actorId = await admissionSponsor(f, [roundId]);
    const seat =
      mode === 'human'
        ? await f.seat(roundId, 'judge')
        : await createBotSeat(f, roundId, 'judge');
    if (mode === 'erased')
      await f.sql`update users set deleted_at=clock_timestamp() where id=(select user_id from actors where id=${actorId})`;
    if (mode === 'ranked')
      await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
    if (mode === 'service')
      await f.sql`update rounds set created_by_actor_id=null where id=${roundId}`;
    if (mode === 'host_changed') {
      const [round] =
        await f.sql`select format_id from rounds where id=${roundId}`;
      const currentHost = await f.actor();
      const roomId = await f.room(currentHost, round.format_id);
      await f.sql`update rounds set room_id=${roomId},room_config_snapshot=(select config from rooms where id=${roomId}),visibility='public' where id=${roundId}`;
      // New grants/current host must not change frozen historical attribution.
      await f.sql`delete from account_entitlement_grants where user_id=(select user_id from actors where id=${actorId})`;
    }
    await f.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,0,'complete')`;
    const hasAttempt = [
      'unknown',
      'live_received',
      'failed_unrestored',
      'failed_retryable',
      'invalid_received',
      'invalid_unknown',
      'reconstructed',
      'legacy_failed',
      'mixed',
      'late_unknown',
      'missing_attempt',
      'uncorroborated_failed',
    ].includes(mode);
    await f.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,attempts,terminal_reason,generation_deadline_at,created_at)
    values(${roundId},${seat.id},1,${terminal ? 'failed' : 'queued'},${hasAttempt ? 1 : 0},${terminal ? 'round_ended' : null},clock_timestamp()+interval '5 minutes',${new Date(originalAdmission)})`;
    let execution = null;
    if (hasAttempt || mode === 'deadline_only' || mode === 'missing_attempt') {
      const id = createId();
      const failed =
        mode.startsWith('failed_') ||
        mode.startsWith('invalid_') ||
        [
          'legacy_failed',
          'uncorroborated_failed',
          'mixed',
          'late_unknown',
          'missing_attempt',
        ].includes(mode);
      const received = [
        'live_received',
        'invalid_received',
        'reconstructed',
      ].includes(mode);
      const category =
        mode.startsWith('failed_') ||
        ['legacy_failed', 'uncorroborated_failed', 'mixed'].includes(mode)
          ? 'provider_refused'
          : mode === 'late_unknown'
            ? 'timeout'
            : 'schema_rejected';
      const token = randomBytes(32).toString('base64url');
      const scope = {
        roundId,
        judgeParticipantId: seat.id,
        agentRunId: id,
        serviceId: `agent-run:${id}`,
        commandId: createId(),
        freezeRevision: 1,
        jobEpoch: 1,
      };
      execution = { scope, token };
      await f.insert('agent_runs', {
        id,
        round_participant_id: seat.id,
        kind: 'judging',
        provider: 'fixture',
        requests: ['uncorroborated_failed', 'deadline_only'].includes(mode)
          ? 0
          : 1,
        configuration_snapshot: {
          ...scope,
          executionTokenDigest: agentLeaseDigest(token),
        },
        input_tokens: received ? 7 : 0,
        started_at: new Date(originalAdmission),
        ended_at: new Date(originalAnswer),
      });
      if (mode !== 'deadline_only' && mode !== 'missing_attempt')
        await f.sql`insert into round_judging_attempts(agent_run_id,round_id,judge_participant_id,job_epoch,model,contract_version,outcome,category,diagnostic,created_at,answered_at)
      values(${id},${roundId},${seat.id},1,'fixture',${mode === 'reconstructed' ? 'unrecorded' : 'fixture-contract'},${failed ? 'failed' : 'dispatched'},${failed ? category : null},${failed ? { category, finish: 'none', issueCount: 0, issues: [] } : null},${new Date(['reconstructed', 'legacy_failed'].includes(mode) ? originalAnswer : originalDispatch)},${received ? new Date(originalAnswer) : null})`;
      if (mode === 'mixed') {
        const laterId = createId();
        await f.insert('agent_runs', {
          id: laterId,
          round_participant_id: seat.id,
          kind: 'judging',
          provider: 'fixture',
          requests: 1,
          started_at: new Date(originalAnswer),
        });
        await f.sql`insert into round_judging_attempts(agent_run_id,round_id,judge_participant_id,job_epoch,model,contract_version,outcome,created_at)
          values(${laterId},${roundId},${seat.id},2,'fixture','fixture-contract','dispatched',${new Date(originalAnswer)})`;
      }
    }
    let existingId: string | null = null;
    if (mode === 'existing') {
      existingId = createId();
      await f.insert('usage_reservations', {
        id: existingId,
        actor_id: actorId,
        round_id: roundId,
        kind: 'casual_ai_judge',
        source: { kind: 'lifetime' },
        state: { kind: 'reserved' },
        reserved_at: new Date(originalAdmission),
      });
    }
    return {
      mode,
      roundId,
      actorId,
      judgeParticipantId: seat.id,
      existingId,
      execution,
    };
  } catch (error) {
    await f.sql`delete from rounds where id=${roundId}`;
    throw error;
  }
}
