import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { NecessaryEvidenceRetirement } from '../src/necessary-evidence-retirement/necessary-evidence-retirement';
import { withBoundedRound } from './bounded-transaction.test-support';
setupRitewayBun();
requireTestServices(process.env);
type Fixture = Parameters<Parameters<typeof withBoundedRound>[0]>[0];
/** Synthetic already-fenced cleanup metadata only. No admitted audio or original-capture authenticity claim. */
async function debt(f: Fixture, roundId: string, attached: boolean, count = 1) {
  for (let i = 0; i < count; i++)
    await f.sql`insert into necessary_evidence(id,round_id,original_round_id,session_id,segment_id,round_participant_id,worker_id,capture_epoch,binding_digest,state,retirement_reason,reserved_bytes,authority_id) values(${createId()},${attached ? roundId : null},${roundId},${createId()},${createId()},${createId()},${createId()},1,${'b'.repeat(64)},'retiring','erased',0,${'c'.repeat(24)})`;
}
for (const lane of ['attached', 'detached'] as const)
  test(`${lane} cleanup pages eligible distinct Rounds before its bound and excludes another worker's live Round`, async () => {
    await withBoundedRound(async (f, run, firstRound) => {
      const secondRound = await f.round();
      const rounds = [firstRound, secondRound];
      try {
        await debt(f, firstRound, lane === 'attached', 70);
        await debt(f, secondRound, lane === 'attached');
        const cleanup = NecessaryEvidenceRetirement.create({
          run,
          leaseMs: 15000,
          retryMs: 1000,
          nextToken: () => randomBytes(32).toString('base64url'),
        });
        const first = await cleanup.claim({ workerId: createId(), lane });
        const second = await cleanup.claim({ workerId: createId(), lane });
        const whileBothLive = await cleanup.claim({
          workerId: createId(),
          lane,
        });
        const [firstRow] =
          first.kind === 'claimed'
            ? await f.sql`select original_round_id from necessary_evidence where id=${first.identity.evidenceId}`
            : [];
        const [secondRow] =
          second.kind === 'claimed'
            ? await f.sql`select original_round_id from necessary_evidence where id=${second.identity.evidenceId}`
            : [];
        assert({
          given:
            'more than64 older due siblings and another due Round, while another worker owns the first Round',
          should:
            'leave its siblings fenced behind that live claim and use the free lane for the other eligible Round',
          actual: {
            rounds: [firstRow?.original_round_id, secondRow?.original_round_id],
            whileBothLive,
          },
          expected: { rounds, whileBothLive: { kind: 'idle' } },
        });
      } finally {
        for (const roundId of rounds)
          await f.sql`delete from necessary_evidence where original_round_id=${roundId}`;
      }
    });
  });

test('finished siblings retain the actual Round service turn and new arrivals cannot permanently outrank older served due recovery', async () => {
  await withBoundedRound(async (f, run, firstRound) => {
    const rounds = [firstRound, await f.round()];
    try {
      await debt(f, rounds[0]!, true, 3);
      await debt(f, rounds[1]!, true);
      const cleanup = NecessaryEvidenceRetirement.create({
        run,
        leaseMs: 15000,
        retryMs: 1000,
        nextToken: () => randomBytes(32).toString('base64url'),
      });
      const first = await cleanup.claim({
        workerId: createId(),
        lane: 'attached',
      });
      if (first.kind !== 'claimed') throw new Error('Expected first claim');
      await cleanup.complete(first);
      const second = await cleanup.claim({
        workerId: createId(),
        lane: 'attached',
      });
      if (second.kind !== 'claimed') throw new Error('Expected second claim');
      const [secondRow] =
        await f.sql`select original_round_id from necessary_evidence where id=${second.identity.evidenceId}`;
      await cleanup.complete(second);
      // Leave firstRound's served due siblings; each following pass adds a new unserved Round.
      const served: string[] = [];
      for (let pass = 0; pass < 4; pass++) {
        const arrival = await f.round();
        rounds.push(arrival);
        await debt(f, arrival, true);
        const next = await cleanup.claim({
          workerId: createId(),
          lane: 'attached',
        });
        if (next.kind !== 'claimed') throw new Error('Expected fair due claim');
        const [row] =
          await f.sql`select original_round_id from necessary_evidence where id=${next.identity.evidenceId}`;
        served.push(row!.original_round_id);
        await cleanup.complete(next);
      }
      assert({
        given:
          'actual committed firstRound service on a finished sibling, an older untouched Round, and repeated new arrivals while served siblings remain due',
        should:
          'serve the other older Round after the first turn, then revisit served recovery despite unserved arrivals',
        actual: {
          nextRound: secondRow!.original_round_id,
          servedRecovery: served.includes(firstRound),
        },
        expected: { nextRound: rounds[1], servedRecovery: true },
      });
    } finally {
      for (const roundId of rounds)
        await f.sql`delete from necessary_evidence where original_round_id=${roundId}`;
    }
  });
});
