import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rateCompletedRound } from '../src/features/ratings/rate-debate';
import {
  ballotCommand,
  finalizations,
  frozenRankedPanel,
  holdRound,
  inSeason,
  lockWaiters,
  readLedger,
  readVersions,
  withClients,
  withWebInstances,
} from './judged-rating.test-support';
import {
  frozenRankedRound,
  recoverRankedResults,
} from './ranked-room.test-support';
import { passBallotDeadline } from './round-maintenance.test-support';
import { withRoomRuntime } from './round-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('three postings overlapping on the Round lock from separate sessions write one result', async () => {
  await withRoomRuntime(async (f) => {
    await inSeason(f, async () => {
      const { roundId, freezeRevision } = await frozenRankedRound(
        f,
        'policy',
        'human',
      );
      await (
        await ballotCommand(
          f,
          roundId,
          f.outsider.actorId,
          freezeRevision,
          'negative',
        )
      )();
      await withClients(3, async (clients) => {
        const release = await holdRound(roundId);
        const attempts = clients.map((client) =>
          rateCompletedRound(client, roundId, { next: createId }),
        );
        try {
          await lockWaiters(f.sql, 3);
        } finally {
          await release();
        }
        const results = await Promise.all(attempts);
        assert({
          given: 'three postings observed waiting together on one Round',
          should: 'let one rate and tell the others it is already rated',
          actual: {
            kinds: results.map((r) => r.kind).sort(),
            rows: (await readLedger(f, roundId)).length,
            versions: await readVersions(f),
          },
          expected: {
            kinds: ['already-rated', 'already-rated', 'rated'],
            rows: 2,
            versions: [1, 1],
          },
        });
      });
    });
  });
});

test('a posting queued behind the deciding ballot sees the committed finalization, and a sweep before it finds nothing', async () => {
  await withRoomRuntime(async (f) => {
    await inSeason(f, async () => {
      const { roundId, freezeRevision } = await frozenRankedRound(
        f,
        'policy',
        'human',
      );
      const submit = await ballotCommand(
        f,
        roundId,
        f.outsider.actorId,
        freezeRevision,
        'affirmative',
      );
      await withClients(1, async ([client]) => {
        const release = await holdRound(roundId);
        let deciding: ReturnType<typeof submit> | undefined;
        let posting: ReturnType<typeof rateCompletedRound> | undefined;
        try {
          deciding = submit();
          await lockWaiters(f.sql, 1);
          const earlySweep = await f.store.readUnratedRatingRounds({
            limit: 64,
          });
          assert({
            given: 'the deciding ballot still uncommitted',
            should: 'discover nothing to rate and await no rating',
            actual: {
              discovered: earlySweep.includes(roundId),
              awaits: await f.store.readRoundAwaitsRating(roundId),
            },
            expected: { discovered: false, awaits: false },
          });
          posting = rateCompletedRound(client!, roundId, { next: createId });
          await lockWaiters(f.sql, 2);
        } finally {
          await release();
        }
        const [receipt, result] = await Promise.all([deciding, posting!]);
        const done = (await f.store.getRound(roundId))!;
        assert({
          given: 'a posting that queued on the Round lock behind the ballot',
          should: 'read the decided outcome after the lock and post once',
          actual: {
            decided: receipt.outcome,
            result: result.kind,
            outcome: done.outcome,
            rows: (await readLedger(f, roundId)).length,
          },
          expected: {
            decided: 'affirmative',
            result: 'rated',
            outcome: 'affirmative',
            rows: 2,
          },
        });
      });
    });
  });
});

test('two judges ruling together with sweeps running decide once and post once', async () => {
  await withRoomRuntime(async (f) => {
    await inSeason(f, async () => {
      const { roundId, judges, freezeRevision } = await frozenRankedPanel(f);
      const submits = await Promise.all(
        judges.map((judge) =>
          ballotCommand(f, roundId, judge.actorId, freezeRevision, 'negative'),
        ),
      );
      await withClients(2, async (clients) => {
        await Promise.all([
          ...submits.map((submit, i) => submit(clients[i]!)),
          recoverRankedResults(f),
        ]);
        await recoverRankedResults(f);
        const [counts] = await finalizations(f, roundId);
        assert({
          given: 'both judges ruling at once while recovery scans',
          should: 'finalize one outcome with both ballots and post once',
          actual: {
            outcome: (await f.store.getRound(roundId))!.outcome,
            counts,
            rows: (await readLedger(f, roundId)).length,
            versions: await readVersions(f),
          },
          expected: {
            outcome: 'negative',
            counts: { finalized: 1, ballots: 2 },
            rows: 2,
            versions: [1, 1],
          },
        });
      });
    });
  });
});

test('two instances completing at the ballot deadline while rating decide once and post the lone ballot once', async () => {
  await withRoomRuntime(async (f) => {
    await inSeason(f, async () => {
      const { roundId, judges, freezeRevision } = await frozenRankedPanel(f);
      await (
        await ballotCommand(
          f,
          roundId,
          judges[0]!.actorId,
          freezeRevision,
          'negative',
        )
      )();
      await passBallotDeadline(f.sql, roundId);
      await withWebInstances(f, 2, async (instances) => {
        await Promise.all(
          instances.flatMap((i) => [i.finalize(roundId), i.rateUnrated()]),
        );
        await Promise.all(instances.map((i) => i.rateUnrated()));
        const [counts] = await finalizations(f, roundId);
        assert({
          given: 'one judge silent past the deadline and racing maintenance',
          should: 'complete once for the ruling side and post once',
          actual: {
            outcome: (await f.store.getRound(roundId))!.outcome,
            completes: (
              await f.sql`select command_id from round_commands where round_id=${roundId} and type='complete'`
            ).length,
            counts,
            rows: (await readLedger(f, roundId)).length,
            versions: await readVersions(f),
          },
          expected: {
            outcome: 'negative',
            completes: 1,
            counts: { finalized: 1, ballots: 1 },
            rows: 2,
            versions: [1, 1],
          },
        });
      });
    });
  });
});
