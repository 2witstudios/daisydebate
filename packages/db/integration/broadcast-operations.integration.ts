import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  claimBroadcast,
  completeBroadcast,
  listOpenBroadcasts,
  openBroadcast,
  readReleasedThrough,
  recordFinalMediaEnd,
  recordObserverRestored,
  recordObserverRevoked,
  recordRevocationFailed,
  recordSegmentReleased,
} from '../src/broadcast-operations';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const policy = { kind: 'delay', seconds: 60 } as const;
const now = new Date('2026-11-02T00:00:00.000Z');
const later = new Date('2026-11-02T00:01:00.000Z');

const withOps = async (
  run: (
    db: ReturnType<typeof drizzle>,
    roundId: string,
    sql: SQL,
  ) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 4 });
  try {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      try {
        await run(drizzle({ client }), roundId, client);
      } finally {
        await client`delete from broadcasts where round_id=${roundId}`;
      }
    });
  } finally {
    await client.close();
  }
};

test('one Broadcast per Round, and its policy is kept', async () => {
  await withOps(async (db, roundId) => {
    const first = await openBroadcast(db, {
      id: createId(),
      roundId,
      releasePolicy: policy,
    });
    const again = await openBroadcast(db, {
      id: createId(),
      roundId,
      releasePolicy: { kind: 'round_end' },
    });
    assert({
      given: 'a second open for the same Round',
      should: 'return the first, unchanged',
      actual: [again.id, again.releasePolicy],
      expected: [first.id, policy],
    });
  });
});

test('the database refuses a release policy it does not know', async () => {
  await withOps(async (_db, roundId, sql) => {
    const refusal =
      await sql`insert into broadcasts(id,round_id,release_policy) values (${createId()},${roundId},${{ kind: 'live' }}::jsonb)`.then(
        () => 'accepted',
        (e: { constraint?: string }) => e.constraint,
      );
    assert({
      given: 'an unknown release policy written directly',
      should: 'be refused by constraint',
      actual: refusal,
      expected: 'broadcasts_release_policy_check',
    });
  });
});

test('workers cannot both hold a Broadcast, and an expired lease fences the last owner', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      releasePolicy: policy,
    });
    const claim = (owner: string, at: Date, until: Date) =>
      db.transaction((tx) =>
        claimBroadcast(tx, { owner, now: at, leaseUntil: until }),
      );
    const claims = await Promise.all(
      ['a', 'b', 'c', 'd'].map((o) => claim(o, now, later)),
    );
    const ours = claims.filter((c) => c?.id === open.id);
    assert({
      given: 'four workers claiming the same Broadcast at once',
      should: 'give it to exactly one',
      actual: ours.length,
      expected: 1,
    });
    const first = ours[0]!;
    const next = await claim('next', later, new Date(later.getTime() + 60_000));
    assert({
      given: 'the lease expired and a new worker claiming',
      should: 'take it with a higher epoch',
      actual: [next?.id, next!.leaseEpoch > first.leaseEpoch],
      expected: [open.id, true],
    });
    const fenced = await recordSegmentReleased(db, {
      id: open.id,
      owner: first.leaseOwner!,
      epoch: first.leaseEpoch,
      segment: 0,
      mediaEnd: later,
    });
    assert({
      given: 'the fenced worker recording a release',
      should: 'move neither the cursor nor the watermark',
      actual: [fenced, await readReleasedThrough(db, roundId)],
      expected: [false, null],
    });
  });
});

test('the cursor only moves forward and the watermark never recedes', async () => {
  await withOps(async (db, roundId) => {
    await openBroadcast(db, {
      id: createId(),
      roundId,
      releasePolicy: policy,
    });
    const job = (await db.transaction((tx) =>
      claimBroadcast(tx, { owner: 'w', now, leaseUntil: later }),
    ))!;
    const record = (segment: number, mediaEnd: Date) =>
      recordSegmentReleased(db, {
        id: job.id,
        owner: 'w',
        epoch: job.leaseEpoch,
        segment,
        mediaEnd,
      });
    const skip = await record(3, later);
    const first = await record(0, later);
    const replay = await record(0, later);
    const older = await record(1, now);
    assert({
      given: 'a skipped segment, the right one, a replay, then older media',
      should:
        'refuse the skip and the replay, and keep the higher watermark for the older media',
      actual: [
        skip,
        first,
        replay,
        older,
        (await readReleasedThrough(db, roundId))?.toISOString(),
      ],
      expected: [false, true, false, true, later.toISOString()],
    });
  });
});

test('reconcile records are idempotent and a revocation resets its failures', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      releasePolicy: policy,
    });
    const read = async () =>
      (await listOpenBroadcasts(db, 1000)).find((b) => b.id === open.id);
    await recordRevocationFailed(db, open.id);
    await recordRevocationFailed(db, open.id);
    const failures = (await read())!.revocationFailures;
    await recordObserverRevoked(db, { id: open.id, now });
    const revoked = await read();
    await recordObserverRestored(db, open.id);
    await recordFinalMediaEnd(db, { id: open.id, at: now });
    await recordFinalMediaEnd(db, { id: open.id, at: later });
    const ended = await read();
    await completeBroadcast(db, { id: open.id, at: later });
    assert({
      given: 'two failures, a revocation, a restore, two ends and a completion',
      should:
        'count failures, reset them on revocation, keep the first end, and drop off the open list',
      actual: [
        failures,
        revoked!.revocationFailures,
        revoked!.observerRevokedAt?.toISOString(),
        ended!.observerRevokedAt,
        ended!.finalMediaEndAt?.toISOString(),
        await read(),
      ],
      expected: [2, 0, now.toISOString(), null, now.toISOString(), undefined],
    });
  });
});
