import { requireTestServices } from '@daisy/config';
import { createDatabase, type Database } from '@daisy/db';
import { withSeasons } from '@daisy/db/seasons';
import type { Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { createRoundBallotOperations } from '../src/features/round-ballots/operations';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
import {
  fixtureBallot,
  playOut,
  readyTwoHumanJudgeRoom,
} from './round-judging.test-support';
import {
  finalizeAsWeb,
  ordinaryMaintenance,
} from './round-maintenance.test-support';
import {
  launchRuntimeRound,
  type withRoomRuntime,
} from './round-runtime.test-support';

const { databaseUrl } = requireTestServices(process.env);
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Side = Ballot['winner'];

export const ruling = (winner: Side) =>
  fixtureBallot('Controlled shared ballot, not provider evidence.', winner);

/** Fully separate pools, so each contender holds its own PostgreSQL session. */
export async function withClients<T>(
  count: number,
  work: (clients: readonly Database[]) => Promise<T>,
) {
  const clients = Array.from({ length: count }, () =>
    createDatabase({ url: databaseUrl, nextActorId: createId }),
  );
  try {
    return await work(clients);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }
}

/** An active season for the work, and no rating residue after it. */
export async function inSeason<T>(f: Fixture, work: () => Promise<T>) {
  const seasonId = createId();
  await withSeasons(databaseUrl, (s) => s.activateBetaSeason({ id: seasonId }));
  try {
    return await work();
  } finally {
    await f.sql`delete from rating_changes where actor_id in (${f.host.actorId},${f.guest.actorId})`;
    await f.sql`delete from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`;
    await f.sql`delete from agreement_signatures where season_id=${seasonId}`;
    await f.sql`delete from seasons where id=${seasonId}`;
  }
}

/** Production maintenance for `count` web instances under fresh leases. */
export async function withWebInstances<T>(
  f: Fixture,
  count: number,
  work: (
    instances: readonly ReturnType<typeof ordinaryMaintenance>[],
  ) => Promise<T>,
) {
  const ids = Array.from({ length: count }, () => createId());
  for (const instanceId of ids)
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
  try {
    return await work(ids.map((id) => ordinaryMaintenance(f.store, id)));
  } finally {
    for (const instanceId of ids)
      await f.sql`delete from service_instances where instance_id=${instanceId}`;
  }
}

type LedgerRow = {
  actor_id: string;
  rating_before: number;
  rating_after: number;
  deviation_after: number;
  volatility_after: number;
};
export const readLedger = (f: Fixture, roundId: string): Promise<LedgerRow[]> =>
  f.sql`select actor_id,rating_before,rating_after,deviation_after,volatility_after
    from rating_changes where round_id=${roundId} order by actor_id`;

export const readVersions = async (f: Fixture) =>
  (
    (await f.sql`select version from ratings where actor_id in (${f.host.actorId},${f.guest.actorId})`) as {
      version: number;
    }[]
  )
    .map((row) => row.version)
    .sort();

/** Wait until PostgreSQL itself shows `count` sessions waiting on a lock. */
export async function lockWaiters(observer: SQL, count: number) {
  const until = performance.now() + 5000;
  while (performance.now() < until) {
    const [row] =
      await observer`select count(*)::integer as waiting from pg_stat_activity
        where datname=current_database() and cardinality(pg_blocking_pids(pid))>0`;
    if ((row as { waiting: number }).waiting >= count) return;
    await Bun.sleep(5);
  }
  throw Error(`Expected ${count} sessions waiting on a lock`);
}

/** Holds the Round row lock on its own session until released. */
export async function holdRound(roundId: string) {
  const client = new SQL(databaseUrl, { max: 1 });
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const work = client.begin(async (tx) => {
    await tx`select id from rounds where id=${roundId} for no key update`;
    held.resolve();
    await release.promise;
  });
  await held.promise;
  return async () => {
    release.resolve();
    await work;
    await client.close();
  };
}

const seatOf = async (f: Fixture, roundId: string, actorId: string) => {
  const round = (await f.store.getRound(roundId))!;
  return {
    version: round.version,
    seat: round.participants.find(
      (p) => p.actorId === actorId && p.role === 'judge',
    )!.id,
  };
};

export const ballotCommand = async (
  f: Fixture,
  roundId: string,
  actorId: string,
  freezeRevision: number,
  winner: Side,
) => {
  const { version, seat } = await seatOf(f, roundId, actorId);
  const envelope = {
    version: 1 as const,
    commandId: createId(),
    expectedVersion: version,
    judgeParticipantId: seat,
    freezeRevision,
    ballot: ruling(winner),
  };
  return (store: Database = f.store) =>
    createRoundBallotOperations({
      store,
      nextBallotId: createId,
      nextSegmentId: createId,
    }).submit({ kind: 'human', actorId }, roundId, envelope);
};

/** A two-judge Round made ranked and frozen complete, as DEC-277's proof does. */
export async function frozenRankedPanel(f: Fixture) {
  const { room, judges } = await readyTwoHumanJudgeRoom(f);
  const { roundId } = await launchRuntimeRound(f, room);
  await f.sql`update rounds set competition_type='ranked',format_id='freestyle',format_version=1,preset_version=1,ladder_id='freestyle' where id=${roundId}`;
  await playOut(f, roundId, true);
  const frozen = await finalizeAsWeb(f, roundId);
  if (frozen.status !== 'frozen' || frozen.freeze.completeness !== 'complete')
    throw Error('Expected complete shared freeze');
  await seedSettledAttendanceLedger(f, roundId);
  return { roundId, judges, freezeRevision: frozen.freeze.revision };
}

export const finalizations = (f: Fixture, roundId: string) =>
  f.sql`select (select count(*)::integer from round_finalizations where round_id=${roundId}) as finalized,
    (select count(*)::integer from round_finalization_ballots where round_id=${roundId}) as ballots`;
