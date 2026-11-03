import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readConversationHeld,
  readOfficialFeedFacts,
  recordEgressStarted,
  recordFeedWithdrawn,
  claimBroadcast,
  claimBroadcastReconcile,
  completeBroadcast,
  discoverUnopenedBroadcastRounds,
  listOpenBroadcasts,
  openBroadcast,
  readReleasedThrough,
  recordFinalMediaEnd,
  recordObserverRestored,
  recordObserverRevoked,
  recordRevocationFailed,
  recordSegmentReleased,
  renewBroadcastLease,
  stopBroadcast,
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
      feedKey: createId(),
      releasePolicy: policy,
    });
    const again = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
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
      await sql`insert into broadcasts(id,round_id,feed_key,release_policy) values (${createId()},${roundId},${createId()},${{ kind: 'live' }}::jsonb)`.then(
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
      feedKey: createId(),
      releasePolicy: policy,
    });
    const claim = (owner: string, at: Date, until: Date) =>
      db.transaction((tx) =>
        claimBroadcast(tx, {
          owner,
          now: at,
          leaseUntil: until,
          withdrawFinishedBefore: at,
        }),
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
      feedKey: createId(),
      releasePolicy: policy,
    });
    const job = (await db.transaction((tx) =>
      claimBroadcast(tx, {
        owner: 'w',
        now,
        leaseUntil: later,
        withdrawFinishedBefore: now,
      }),
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
      feedKey: createId(),
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

test('a held lease renews with fresh facts, and refuses a fenced owner', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const job = (await db.transaction((tx) =>
      claimBroadcast(tx, {
        owner: 'w',
        now,
        leaseUntil: later,
        withdrawFinishedBefore: now,
      }),
    ))!;
    await recordFinalMediaEnd(db, { id: open.id, at: now });
    const much = new Date(later.getTime() + 60_000);
    const renewed = await renewBroadcastLease(db, {
      id: open.id,
      owner: 'w',
      epoch: job.leaseEpoch,
      leaseUntil: much,
    });
    const fenced = await renewBroadcastLease(db, {
      id: open.id,
      owner: 'w',
      epoch: job.leaseEpoch - 1,
      leaseUntil: much,
    });
    assert({
      given: 'the owner renewing, and a stale epoch renewing',
      should:
        'extend the lease and return the fresh row for the owner, and null for the stale one',
      actual: [
        renewed?.leaseUntil?.toISOString(),
        renewed?.finalMediaEndAt?.toISOString(),
        fenced,
      ],
      expected: [much.toISOString(), now.toISOString(), null],
    });
  });
});

test('one web instance reconciles a Broadcast at a time', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const claim = (at: Date) =>
      claimBroadcastReconcile(db, {
        id: open.id,
        now: at,
        until: new Date(at.getTime() + 5000),
      });
    const racing = await Promise.all([claim(now), claim(now), claim(now)]);
    const expired = await claim(new Date(now.getTime() + 5000));
    assert({
      given: 'three instances racing, then one after the lease ends',
      should: 'let exactly one through, and then the later one',
      actual: [racing.filter(Boolean).length, expired],
      expected: [1, true],
    });
  });
});

test('conversation stays held until the observer is revoked, however long that takes', async () => {
  await withOps(async (db, roundId) => {
    const held = () => readConversationHeld(db, { roundId });
    const none = await held();
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const noEgress = await held();
    await recordEgressStarted(db, {
      generation: 1,
      id: open.id,
      egressId: 'EG',
      stageCredentialHash: 'h',
      now,
    });
    const observing = await held();
    await recordObserverRevoked(db, { id: open.id, now });
    const revoked = await held();
    assert({
      given:
        'no Broadcast, no Egress, a subscribed observer with no time limit, then revoked',
      should:
        'never open the microphone while the observer may still receive it',
      actual: [none, noEgress, observing, revoked],
      expected: [false, false, true, false],
    });
  });
});

test('an operator stop stands once, and a missing Broadcast says so', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const first = await stopBroadcast(db, {
      id: open.id,
      reason: 'policy_violation',
      now,
    });
    const repeat = await stopBroadcast(db, {
      id: open.id,
      reason: 'technical',
      now: later,
    });
    const stored = (await listOpenBroadcasts(db, 100)).find(
      (row) => row.id === open.id,
    );
    assert({
      given: 'a stop, a repeat with another reason, and an unknown Broadcast',
      should: 'apply once, keep the first stop, and answer null for the last',
      actual: [
        first,
        repeat,
        stored?.stopReason,
        stored?.stoppedAt?.toISOString(),
        await stopBroadcast(db, { id: createId(), reason: 'technical', now }),
      ],
      expected: [
        'applied',
        'unchanged',
        'policy_violation',
        now.toISOString(),
        null,
      ],
    });
  });
});

test('a completed Broadcast cannot be stopped', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    await completeBroadcast(db, { id: open.id, at: now });
    assert({
      given: 'a Broadcast already complete',
      should: 'leave it unchanged',
      actual: await stopBroadcast(db, {
        id: open.id,
        reason: 'technical',
        now,
      }),
      expected: 'unchanged',
    });
  });
});

test('discovery finds ranked Rounds and casual Rounds whose host chose a Broadcast', async () => {
  await withFixture(databaseUrl, async (f) => {
    const client = new SQL(databaseUrl, { max: 2 });
    try {
      const chosen = await f.round();
      const recordedOnly = await f.round();
      const nothing = await f.round();
      await client`update rounds set competition_type='casual', ladder_id=null, capture=${JSON.stringify(
        {
          broadcast: {
            release: { kind: 'round_end' },
            debatersReadChat: true,
          },
          recording: false,
        },
      )}::text::jsonb where id=${chosen}`;
      await client`update rounds set competition_type='casual', ladder_id=null, capture=${JSON.stringify(
        { broadcast: null, recording: true },
      )}::text::jsonb where id=${recordedOnly}`;
      await client`update rounds set competition_type='casual', ladder_id=null, capture=null where id=${nothing}`;
      const found = (
        await discoverUnopenedBroadcastRounds(drizzle({ client }), 1000)
      ).map((row) => row.roundId);
      assert({
        given: 'a casual Broadcast choice, a recording alone, and no choice',
        should: 'discover only the Broadcast choice',
        actual: [chosen, recordedOnly, nothing].map((id) => found.includes(id)),
        expected: [true, false, false],
      });
    } finally {
      await client.close();
    }
  });
});

test('a finished Broadcast is claimed once more to withdraw its feed, after its grace', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const claim = (withdrawFinishedBefore: Date) =>
      db.transaction((tx) =>
        claimBroadcast(tx, {
          owner: 'w',
          now,
          leaseUntil: now,
          withdrawFinishedBefore,
        }),
      );
    await completeBroadcast(db, { id: open.id, at: now });
    const inGrace = await claim(new Date(now.getTime() - 1));
    const past = await claim(now);
    await recordFeedWithdrawn(db, { id: open.id, at: later });
    const after = await claim(later);
    assert({
      given:
        'a completed Broadcast inside its grace, past it, and once withdrawn',
      should: 'leave it, claim it, then never claim it again',
      actual: [
        inGrace?.id === open.id,
        past?.id === open.id,
        after?.id === open.id,
      ],
      expected: [false, true, false],
    });
  });
});

test('the official feed facts come from the Broadcast and its Round', async () => {
  const client = new SQL(databaseUrl, { max: 2 });
  const db = drizzle({ client });
  try {
    await withFixture(databaseUrl, async (f) => {
      const roundId = await f.round();
      try {
        const none = await readOfficialFeedFacts(db, { roundId });
        const open = await openBroadcast(db, {
          id: createId(),
          roundId,
          feedKey: createId(),
          releasePolicy: policy,
        });
        assert({
          given: 'a Round with no Broadcast, then with one',
          should: 'answer null, then its facts',
          actual: [none, await readOfficialFeedFacts(db, { roundId })],
          expected: [
            null,
            {
              feedKey: open.feedKey,
              visibility: null,
              audienceLinkHash: null,
              stoppedAt: null,
              completedAt: null,
            },
          ],
        });
      } finally {
        await client`delete from broadcasts where round_id=${roundId}`;
      }
    });
  } finally {
    await client.close();
  }
});
