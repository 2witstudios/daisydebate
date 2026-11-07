import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { lockAuthorizationActors } from '../src/authorization';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBoundedRound } from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('canonical account erasure refuses raw evidence before delayed cleanup reaches its Round', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const id = createId();
    try {
      await f.sql`update users set deleted_at=clock_timestamp(),email_verified=false,version=version+1
        where id in (select a.user_id from actors a join round_participants p on p.actor_id=a.id where p.id=${window.roundParticipantId})`;
      const outcome = await store
        .reserveCaptureEvidence({
          ...window,
          evidenceId: id,
          bodyDigest: 'b'.repeat(64),
          reservedBytes: 600,
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const [row] =
        await f.sql`select count(*)::integer as count from necessary_evidence where id=${id}`;
      assert({
        given:
          'the canonical subject tombstone while its original Round and capture lease remain valid',
        should:
          'refuse raw evidence immediately without awaiting cleanup or creating custody work',
        actual: { outcome, count: row!.count },
        expected: { outcome: 'AUTHORIZATION', count: 0 },
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  });
});

test('raw evidence privacy does not invent a membership entitlement rule', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const id = createId();
    try {
      await f.sql`update users set email_verified=false,version=version+1 where id in
        (select a.user_id from actors a join round_participants p on p.actor_id=a.id where p.id=${window.roundParticipantId})`;
      const reply = await store.reserveCaptureEvidence({
        ...window,
        evidenceId: id,
        bodyDigest: 'b'.repeat(64),
        reservedBytes: 600,
      });
      assert({
        given:
          'an existing original capture grant and a live account without member verification',
        should:
          'apply canonical erasure independently of membership without replacing capture authorization',
        actual: reply.kind,
        expected: 'claimed',
      });
    } finally {
      await f.sql`delete from necessary_evidence where id=${id}`;
    }
  });
});

/** Observe actual lock dependencies; elapsed waiting is never the assertion. */
async function blockedBy(
  observer: SQL,
  blocker: number,
  count = 1,
  target?: number,
) {
  const until = performance.now() + 600;
  let pids: number[] = [];
  while (performance.now() < until) {
    const rows = await observer`with recursive dependencies(pid, depth) as (
        select pid,1 from pg_stat_activity where datname=current_database() and ${blocker}=any(pg_blocking_pids(pid))
        union all
        select a.pid,d.depth+1 from pg_stat_activity a join dependencies d on d.pid=any(pg_blocking_pids(a.pid))
          where a.datname=current_database() and d.depth<8
      ) select distinct pid from dependencies where pid<>${blocker}`;
    pids = rows.map((row: { pid: number }) => row.pid);
    if (target === undefined ? pids.length >= count : pids.includes(target))
      return pids;
    await Bun.sleep(5);
  }
  return pids;
}

test('two evidence readers precede account closure without lock upgrades or reverse acquisition', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const [subject] =
      await f.sql`select a.id as actor_id from actors a join round_participants p on p.actor_id=a.id where p.id=${window.roundParticipantId}`;
    const ids = [createId(), createId()];
    const observer = new SQL(databaseUrl, { max: 2 });
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const holder = f.sql.begin(async (tx) => {
      await tx`select id from rounds where id=${roundId} for no key update`;
      const [row] = await tx`select pg_backend_pid() as pid`;
      ready.resolve(row!.pid as number);
      await release.promise;
    });
    let writers: Promise<unknown>[] = [];
    let closure: Promise<unknown> | undefined;
    try {
      const holderPid = await ready.promise;
      writers = ids.map((evidenceId) =>
        store
          .reserveCaptureEvidence({
            ...window,
            evidenceId,
            bodyDigest: 'b'.repeat(64),
            reservedBytes: 400,
          })
          .then(
            (reply) => reply.kind,
            (error: { code: string }) => error.code,
          ),
      );
      const readerPids = await blockedBy(observer, holderPid, 2);
      const closing = Promise.withResolvers<number>();
      closure = observer.begin(async (tx) => {
        const [row] = await tx`select pg_backend_pid() as pid`;
        closing.resolve(row!.pid as number);
        await lockAuthorizationActors(
          drizzle({ client: tx }),
          [subject!.actor_id as string],
          { maxActors: 1 },
        );
        await tx`update users set deleted_at=clock_timestamp(),email_verified=false,version=version+1 where id in (select user_id from actors where id=${subject!.actor_id})`;
      });
      const closerPid = await closing.promise;
      // Other readers can already depend on the first reader. They are not evidence
      // that this closer has reached its account fence: wait for the exact PID.
      const dependencies = await blockedBy(observer, holderPid, 1, closerPid);
      const fenced = dependencies.includes(closerPid);
      release.resolve();
      const outcomes = await Promise.all(writers);
      await closure;
      assert({
        given:
          'two bounded evidence writers waiting on Round after account reads, followed by canonical closure',
        should:
          'share read fences without upgrade, delay closure until both readers commit, and finish without deadlock',
        actual: { readers: readerPids.length, fenced, outcomes },
        expected: {
          readers: 2,
          fenced: true,
          outcomes: ['claimed', 'claimed'],
        },
      });
    } finally {
      release.resolve();
      await Promise.allSettled([
        holder,
        ...writers,
        ...(closure ? [closure] : []),
      ]);
      await f.sql`delete from necessary_evidence where id in (${ids[0]},${ids[1]})`;
      await observer.close({ timeout: 0 });
    }
  });
});

test('an evidence writer queued behind canonical closure reads the committed tombstone', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const [subject] =
      await f.sql`select a.id as actor_id from actors a join round_participants p on p.actor_id=a.id where p.id=${window.roundParticipantId}`;
    const observer = new SQL(databaseUrl, { max: 2 });
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const id = createId();
    let writer: Promise<string> | undefined;
    const closure = observer.begin(async (tx) => {
      await lockAuthorizationActors(
        drizzle({ client: tx }),
        [subject!.actor_id as string],
        { maxActors: 1 },
      );
      await tx`update users set deleted_at=clock_timestamp(),email_verified=false,version=version+1 where id in (select user_id from actors where id=${subject!.actor_id})`;
      const [row] = await tx`select pg_backend_pid() as pid`;
      ready.resolve(row!.pid as number);
      await release.promise;
    });
    try {
      const closerPid = await ready.promise;
      writer = store
        .reserveCaptureEvidence({
          ...window,
          evidenceId: id,
          bodyDigest: 'b'.repeat(64),
          reservedBytes: 600,
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const waiters = await blockedBy(observer, closerPid);
      release.resolve();
      await closure;
      const result = await writer;
      const [row] =
        await f.sql`select count(*)::integer as count from necessary_evidence where id=${id}`;
      assert({
        given:
          'an actual account-closure transaction holding the canonical exclusive fence before capture starts',
        should:
          'wait on that same account fence and refuse the committed tombstone without admitting work',
        actual: { waiting: waiters.length > 0, result, count: row!.count },
        expected: { waiting: true, result: 'AUTHORIZATION', count: 0 },
      });
    } finally {
      release.resolve();
      await Promise.allSettled([closure, ...(writer ? [writer] : [])]);
      await f.sql`delete from necessary_evidence where id=${id}`;
      await observer.close({ timeout: 0 });
    }
  });
});

test('a changed cast after the Round wait refuses instead of adding late account locks', async () => {
  await withBoundedRound(async (f, transaction, roundId) => {
    const { store, window } = await configuredCapture(f, transaction, roundId);
    const observer = new SQL(databaseUrl, { max: 2 });
    const ready = Promise.withResolvers<number>();
    const change = Promise.withResolvers<void>();
    const id = createId();
    let writer: Promise<string> | undefined;
    const mutation = f.sql.begin(async (tx) => {
      await tx`select id from rounds where id=${roundId} for no key update`;
      const [row] = await tx`select pg_backend_pid() as pid`;
      ready.resolve(row!.pid as number);
      await change.promise;
      await tx`update round_participants set slot=slot+1 where id=${window.roundParticipantId}`;
    });
    try {
      const holderPid = await ready.promise;
      writer = store
        .reserveCaptureEvidence({
          ...window,
          evidenceId: id,
          bodyDigest: 'b'.repeat(64),
          reservedBytes: 600,
        })
        .then(
          (reply) => reply.kind,
          (error: { code: string }) => error.code,
        );
      const waiters = await blockedBy(observer, holderPid);
      change.resolve();
      await mutation;
      const result = await writer;
      const [row] =
        await f.sql`select count(*)::integer as count from necessary_evidence where id=${id}`;
      assert({
        given:
          'a cast slot changed under the held Round after original subject discovery',
        should:
          'refuse the stale exact cast and leave no intent or new after-Round account fence',
        actual: { waiting: waiters.length > 0, result, count: row!.count },
        expected: { waiting: true, result: 'CONFLICT', count: 0 },
      });
    } finally {
      change.resolve();
      await Promise.allSettled([mutation, ...(writer ? [writer] : [])]);
      await f.sql`delete from necessary_evidence where id=${id}`;
      await observer.close({ timeout: 0 });
    }
  });
});
