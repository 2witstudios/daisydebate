import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readBroadcastObserverHeld,
  readBroadcastStageHistory,
  readConversationHeld,
  recordEgressStarted,
  recordFeedWithdrawn,
  claimBroadcast,
  claimFeedWithdrawal,
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
import { broadcasts } from '../src/schema/broadcasts';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const policy = { kind: 'delay', seconds: 60 } as const;
const now = new Date('2026-11-02T00:00:00.000Z');
const later = new Date('2026-11-02T00:01:00.000Z');
const past = new Date('2026-11-01T00:00:00.000Z');

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

test('a completed Broadcast is claimed to withdraw its feed once its grace passes', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const claim = (withdrawFinishedBefore: Date) =>
      db.transaction((tx) =>
        claimFeedWithdrawal(tx, {
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

test('a stopped Broadcast goes to withdrawal at once and to no release slot', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    await db
      .update(broadcasts)
      .set({ stoppedAt: now, stopReason: 'technical' })
      .where(eq(broadcasts.id, open.id));
    const lease = { owner: 'w', now, leaseUntil: now };
    const toRelease = await db.transaction((tx) => claimBroadcast(tx, lease));
    const toWithdraw = () =>
      db.transaction((tx) =>
        claimFeedWithdrawal(tx, { ...lease, withdrawFinishedBefore: past }),
      );
    const first = await toWithdraw();
    await recordFeedWithdrawn(db, { id: open.id, at: now });
    const waitingOnEgress = await toWithdraw();
    await db
      .update(broadcasts)
      .set({ finalMediaEndAt: now })
      .where(eq(broadcasts.id, open.id));
    const toComplete = await toWithdraw();
    await completeBroadcast(db, { id: open.id, at: now });
    const finished = await toWithdraw();
    assert({
      given: 'a stop, a withdrawal, the Egress gone, then completion',
      should:
        'never release it, withdraw it at once, wait, finish it, then leave it',
      actual: [
        toRelease?.id === open.id,
        first?.id === open.id,
        waitingOnEgress?.id === open.id,
        toComplete?.id === open.id,
        finished?.id === open.id,
      ],
      expected: [false, true, false, true, false],
    });
  });
});

test('withdrawal waits out a lease still held', async () => {
  await withOps(async (db, roundId) => {
    const open = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    await db
      .update(broadcasts)
      .set({
        stoppedAt: now,
        stopReason: 'technical',
        leaseOwner: 'holder',
        leaseUntil: later,
      })
      .where(eq(broadcasts.id, open.id));
    const at = (when: Date) =>
      db.transaction((tx) =>
        claimFeedWithdrawal(tx, {
          owner: 'w',
          now: when,
          leaseUntil: when,
          withdrawFinishedBefore: past,
        }),
      );
    const held = await at(now);
    const expired = await at(later);
    assert({
      given: 'a stopped Broadcast leased until later',
      should: 'leave it to its holder until the lease expires',
      actual: [held?.id === open.id, expired?.id === open.id],
      expected: [false, true],
    });
  });
});

test('one start is recorded per generation, and a racing one loses', async () => {
  await withOps(async (db, roundId) => {
    const { id } = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const started = (egressId: string, generation: number) =>
      recordEgressStarted(db, {
        id,
        egressId,
        generation,
        stageCredentialHash: `hash-${egressId}`,
        now,
      });
    const raced = await Promise.all([started('EG_A', 1), started('EG_B', 1)]);
    const [row] = await db
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, id));
    const winner = raced[0] ? 'EG_A' : 'EG_B';
    const next = await started('EG_C', 2);
    assert({
      given: 'two reports racing for generation 1, then a report for 2',
      should:
        'let one win, keeping its id and credential alone, then accept the next',
      actual: [
        raced.filter(Boolean).length,
        row?.egressId,
        row?.stageCredentialHash,
        next,
      ],
      expected: [1, winner, `hash-${winner}`, true],
    });
  });
});

test('a hold with nothing due occupies no release slot', async () => {
  await withOps(async (db, roundId) => {
    const { id } = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: { kind: 'round_end' },
    });
    const claim = async (at: Date) => {
      const claimed = await db.transaction((tx) =>
        claimBroadcast(tx, {
          owner: 'w',
          now: at,
          leaseUntil: new Date(at.getTime() + 1),
        }),
      );
      return claimed?.id === id;
    };
    const claimedRunning = await claim(now);
    await recordFinalMediaEnd(db, { id, at: now });
    const claimedEnded = await claim(later);
    await db
      .update(broadcasts)
      .set({
        releasePolicy: { kind: 'at', atMs: later.getTime() },
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(eq(broadcasts.id, id));
    const claimedEarly = await claim(now);
    const claimedAtTime = await claim(later);
    assert({
      given: 'a Round-end hold before and after media ends, then a set time',
      should: 'claim each only once something can be due',
      actual: [claimedRunning, claimedEnded, claimedEarly, claimedAtTime],
      expected: [false, true, false, true],
    });
  });
});

test('paging reaches every open Broadcast, past any page', async () => {
  await withOps(async (db, roundId) => {
    const { id } = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const seen = async () => {
      let after: string | null = null;
      const ids: string[] = [];
      for (;;) {
        const page: { id: string }[] = await listOpenBroadcasts(db, 1, after);
        if (page.length === 0) return ids;
        ids.push(page[0]!.id);
        after = page[0]!.id;
      }
    };
    const ids = await seen();
    assert({
      given: 'pages of one row',
      should: 'reach this Broadcast once, in id order',
      actual: [
        ids.filter((found) => found === id).length,
        ids.every((found, at) => at === 0 || ids[at - 1]! < found),
      ],
      expected: [1, true],
    });
  });
});

test('the worker reads committed times through the view, and no Round', async () => {
  await withOps(async (db, roundId, client) => {
    const { id } = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const segmentId = createId();
    await client`insert into round_segments (id,round_id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms)
      values (${segmentId},${roundId},0,'speech','k',${now},${later},60000)`;
    await client`insert into round_private_spans (round_id,kind,started_at,ended_at)
      values (${roundId},'prep',${later},null)`;
    const history = await readBroadcastStageHistory(db, id);
    await client`delete from round_private_spans where round_id=${roundId}`;
    await client`delete from round_segments where id=${segmentId}`;
    const grant = async (table: string) =>
      (
        await client`select has_table_privilege('daisy_broadcast_worker',${table},'select') as yes`
      )[0]?.yes;
    assert({
      given: 'a committed segment, and the worker role',
      should:
        'read its times through the view, with no grant on any Round table',
      actual: [
        history,
        await grant('broadcast_public_history'),
        await grant('broadcast_private_history'),
        await grant('round_private_spans'),
        await grant('round_segments'),
        await grant('rounds'),
      ],
      expected: [
        {
          segments: [
            {
              startedAtMs: now.getTime(),
              endedAtMs: later.getTime(),
              durationMs: 60_000,
            },
          ],
          privateSpans: [
            { kind: 'prep', startedAtMs: later.getTime(), endedAtMs: null },
          ],
        },
        true,
        true,
        false,
        false,
        false,
      ],
    });
  });
});

test('a claim is the heartbeat', async () => {
  await withOps(async (db, roundId) => {
    const { id } = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const beat = async () =>
      (await db.select().from(broadcasts).where(eq(broadcasts.id, id)))[0]
        ?.controlHeartbeatAt;
    const before = await beat();
    await claimBroadcastReconcile(db, { id, now: later, until: later });
    assert({
      given: 'no heartbeat, then a claim',
      should: 'stamp it',
      actual: [before, (await beat()) instanceof Date],
      expected: [null, true],
    });
  });
});

test('a Broadcast observer holds cameras', async () => {
  await withOps(async (db, roundId) => {
    const { id } = await openBroadcast(db, {
      id: createId(),
      roundId,
      feedKey: createId(),
      releasePolicy: policy,
    });
    const held = () => readBroadcastObserverHeld(db, { roundId });
    const before = await held();
    await recordEgressStarted(db, {
      id,
      egressId: 'EG',
      generation: 1,
      stageCredentialHash: 'h',
      now,
    });
    const observing = await held();
    await recordObserverRevoked(db, { id, now });
    assert({
      given: 'no Egress, a subscribed observer, then a revoked one',
      should: 'hold only the middle',
      actual: [before, observing, await held()],
      expected: [false, true, false],
    });
  });
});
