import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { roundAnalysisPrivacyAdopter } from '../src/round-analysis-privacy';
import { roundTranscriptPrivacyAdopter } from '../src/round-transcript-privacy';
import { usagePrivacyAdopter } from '../src/usage-privacy';
import { runPrivacyErasure } from '../src/privacy/operations';
import { bindings } from './privacy.test-support';
import {
  deliverAnalysis,
  listedSeats,
  withCompletedRound,
} from './round-analysis.test-support';
setupRitewayBun();
requireTestServices(process.env);
async function eraseDebater(client: SQL, actorId: string) {
  const [user] = await client`select user_id from actors where id=${actorId}`;
  await runPrivacyErasure(
    drizzle({ client }),
    {
      subject: { userId: String(user!.user_id), actorId },
      now: new Date().toISOString(),
      vendors: [],
      jobIds: [],
    },
    [
      roundTranscriptPrivacyAdopter,
      roundAnalysisPrivacyAdopter,
      usagePrivacyAdopter,
    ],
    bindings,
  );
}
test('erasure removes every report quoting the subject and preserves terminal request identity', async () =>
  withCompletedRound(
    async ({ client, roundId, aff, neg, seats, jobs, request, facts }) => {
      await request(seats.neg);
      const claim = await deliverAnalysis(jobs, seats.neg, report);
      const exportOf = async (actorId: string) => {
        const [user] =
          await client`select user_id from actors where id=${actorId}`;
        return drizzle({ client }).transaction((tx) =>
          roundAnalysisPrivacyAdopter.export(tx, {
            userId: String(user!.user_id),
            actorId,
          }),
        );
      };
      const exported = await exportOf(neg.actorId);
      assert({
        given: 'two debaters exporting private requested reports',
        should:
          'export only the recipient’s report and no lease/attempt authenticators',
        actual: [
          (exported.round_analyses as { work: { report: unknown } }[]).map(
            (r) => r.work.report,
          ),
          (await exportOf(aff.actorId)).round_analyses,
          JSON.stringify(exported).includes(claim.token),
          JSON.stringify(exported).includes('tokenDigest'),
        ],
        expected: [[report], [], false, false],
      });
      await eraseDebater(client, aff.actorId);
      await assertRejects({
        given:
          'a fresh request by the surviving debater after opponent erasure',
        should: 'refuse despite a retained seat and any ranked evidence',
        code: 'NOT_FOUND',
        actual: () => request(seats.neg),
      });
      const purged = (await facts(neg)).analysis;
      assert({
        given: 'the erased opponent and previously delivered report',
        should:
          'remove report content without recreating an automatic job or resetting identity',
        actual: [
          purged?.kind,
          purged && 'report' in purged,
          (await facts(aff)).analysis,
          (await listedSeats(jobs)).filter((id) =>
            [aff.id, neg.id].includes(id),
          ),
        ],
        expected: ['purged', false, null, []],
      });
      const [row] =
        await client`select count(*)::integer as n from round_analyses where round_id=${roundId}`;
      assert({
        given: 'erasure of an unrequested seat',
        should: 'create no synthetic dispatched call or legacy tombstone',
        actual: row.n,
        expected: 1,
      });
    },
  ));
test('erasure after claim refuses dispatch and leaves no invented usage', async () =>
  withCompletedRound(async ({ client, aff, seats, jobs, request, facts }) => {
    await request(seats.aff);
    const held = await jobs.claim(seats.aff);
    if (!held) throw Error('Expected claim');
    await eraseDebater(client, aff.actorId);
    assert({
      given:
        'a real requested lease paused before its first model call while its owner closes',
      should: 'refuse dispatch under current all-participant authority',
      actual: await jobs.dispatch(seats.aff, held.callId, held.token),
      expected: null,
    });
    await assertRejects({
      given: 'the old lease publishing after erasure',
      should: 'refuse its report',
      code: 'CONFLICT',
      actual: () => jobs.complete(seats.aff, held.callId, held.token, report),
    });
    const state = (await facts(aff)).analysis;
    assert({
      given: 'the retained purged request',
      should: 'keep zero actual calls and remove publication authority',
      actual: [
        state?.kind,
        state?.kind === 'purged' ? state.request?.calls : null,
      ],
      expected: ['purged', []],
    });
  }));

test('late provider accounting after owner erasure preserves observed facts without recreating allowance or content', async () =>
  withCompletedRound(
    async ({ client, fixture, aff, seats, jobs, request, facts }) => {
      await request(seats.aff);
      const claim = await jobs.claim(seats.aff);
      if (!claim) throw Error('Expected claim');
      await jobs.dispatch(seats.aff, claim.callId, claim.token);
      await eraseDebater(client, aff.actorId);
      await jobs.observe(seats.aff, claim.callId, claim.token, {
        kind: 'received',
        inputTokens: 12,
        outputTokens: 3,
      });
      const state = (await facts(aff)).analysis;
      assert({
        given:
          'a counted unknown call whose owner closes before its answer arrives',
        should:
          'keep only purged execution evidence and never recreate the erased reservation',
        actual: [
          state?.kind,
          state?.kind === 'purged' ? state.request?.calls[0]?.outcome : null,
          state && 'report' in state,
          await fixture.count(
            'usage_reservations',
            'round_id',
            seats.aff.roundId,
          ),
          await jobs.dispatch(seats.aff, claim.callId, claim.token),
        ],
        expected: [
          'purged',
          { kind: 'received', inputTokens: 12, outputTokens: 3 },
          false,
          0,
          null,
        ],
      });
      await assertRejects({
        given: 'the old response attempting publication after closure',
        should: 'refuse despite its received accounting',
        code: 'CONFLICT',
        actual: () =>
          jobs.complete(seats.aff, claim.callId, claim.token, report),
      });
    },
  ));

test('opponent erasure leaves recoverable unspent settlement without reopening purged work', async () =>
  withCompletedRound(async ({ client, fixture, neg, seats, jobs, request }) => {
    await request(seats.aff);
    await eraseDebater(client, neg.actorId);
    const pending = (await jobs.scan(64)).some(
      (seat) => seat.roundParticipantId === seats.aff.roundParticipantId,
    );
    const claim = await jobs.claim(seats.aff);
    const [usage] =
      await fixture.sql`select state from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
    const rediscovered = (await jobs.scan(64)).some(
      (seat) => seat.roundParticipantId === seats.aff.roundParticipantId,
    );
    assert({
      given:
        'the opponent purges a queued request without owning its recipient allowance',
      should:
        'let the same bounded scanner release proven nondispatch once, with no provider claim or repeated work',
      actual: [
        pending,
        claim,
        usage.state.kind,
        'countedAt' in usage.state,
        rediscovered,
      ],
      expected: [true, null, 'released', false, false],
    });
  }));
