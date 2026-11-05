import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { withCompletedRound } from './round-analysis.test-support';
import { sqlStateOf } from './constraint-helpers';
setupRitewayBun();
requireTestServices(process.env);

test('daisy_web uses real analysis admission and dispatch while immutable facts and deletion remain protected', async () =>
  withCompletedRound(async ({ client, fixture, seats, request, jobs }) => {
    const reserve = client.reserve.bind(client);
    const roles: string[] = [];
    client.reserve = async (options) => {
      const connection = await reserve(options);
      await connection`set role daisy_web`;
      const [role] = await connection`select current_user as role`;
      roles.push(String(role.role));
      return connection;
    };
    await request(seats.aff);
    const claim = await jobs.claim(seats.aff);
    if (!claim) throw Error('Expected claim');
    await jobs.dispatch(seats.aff, claim.callId, claim.token);
    await jobs.observe(seats.aff, claim.callId, claim.token, {
      kind: 'received',
      inputTokens: 11,
      outputTokens: 3,
    });
    const [before] =
      await fixture.sql`select work,created_at,freeze_revision from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
    const connection = await client.reserve();
    const refusals: string[] = [];
    try {
      for (const mutation of [
        `work=jsonb_set(work,'{requestId}','"${'z'.repeat(24)}"'::jsonb)`,
        `work=jsonb_set(work,'{requestedAt}','"2026-01-01T00:00:00.000Z"'::jsonb)`,
        `work=jsonb_set(work,'{deadlineAt}','"2099-01-01T00:00:00.000Z"'::jsonb)`,
        `work=jsonb_set(work,'{evidenceLines}','999'::jsonb)`,
        `work=jsonb_set(work,'{historical}','{}'::jsonb)`,
        `work=jsonb_set(work,'{claims}','0'::jsonb)`,
        `work=jsonb_set(work,'{calls}','[]'::jsonb)`,
        `work=jsonb_set(work,'{calls,0,dispatchedAt}','"2026-01-01T00:00:00.000Z"'::jsonb)`,
        `work=jsonb_set(work,'{calls,0,outcome}','{"kind":"definite_failure"}'::jsonb)`,
        `freeze_revision=freeze_revision+1`,
        `created_at=created_at+interval '1 second'`,
      ])
        refusals.push(
          await sqlStateOf(() =>
            connection.unsafe(
              `update round_analyses set ${mutation} where round_participant_id=$1`,
              [seats.aff.roundParticipantId],
            ),
          ),
        );
      const deletion = await sqlStateOf(
        () =>
          connection`delete from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`,
      );
      const [after] =
        await fixture.sql`select work,created_at,freeze_revision from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
      assert({
        given:
          'direct runtime attempts to reset identity, original authority, claims or known call facts',
        should: 'refuse all rewrites and deletion and leave state unchanged',
        actual: [refusals, deletion, after],
        expected: [Array.from({ length: 11 }, () => '23514'), '42501', before],
      });
    } finally {
      connection.release();
    }
    await jobs.complete(seats.aff, claim.callId, claim.token, report);
    assert({
      given: 'the production bounded facade running as the runtime role',
      should: 'complete legitimate analysis without owner privilege',
      actual: [
        roles.length > 0,
        roles.every((role) => role === 'daisy_web'),
        (
          await fixture.sql`select work->>'kind' as kind from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`
        )[0].kind,
      ],
      expected: [true, true, 'succeeded'],
    });
  }));
