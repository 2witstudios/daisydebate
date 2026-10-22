import type { Fixture } from './constraint-helpers';
export async function admissionSponsor(
  fixture: Fixture,
  roundIds: readonly string[],
) {
  const user = await fixture.user();
  await fixture.sql`update users set email_verified=true where id=${user}`;
  const actorId = await fixture.actor(user);
  for (const roundId of roundIds)
    await fixture.sql`update rounds set created_by_actor_id=${actorId} where id=${roundId}`;
  return actorId;
}
/** Wait for the real PG lock dependency, then commit the terminal transition ahead of settlement. */
export async function refundAcrossTerminal(
  fixture: Fixture,
  roundId: string,
  terminal: 'abandoned' | 'completed',
  refund: () => Promise<void>,
) {
  const locked = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const committed = fixture.sql.begin(async (tx) => {
    const [backend] = await tx`select pg_backend_pid() as pid`;
    const [state] =
      await tx`update rounds set status=${terminal},current_stage=null,
      started_at=clock_timestamp()-interval '1 second',completed_at=clock_timestamp(),
      outcome=${terminal === 'completed' ? 'affirmative' : null},version=7 where id=${roundId}
      returning status,version,outcome,started_at,completed_at`;
    locked.resolve(backend!.pid);
    await release.promise;
    return state;
  });
  void committed.catch((error) => locked.reject(error));
  const blocker = await locked.promise;
  const settlement = refund().then(
    () => ({ ok: true as const }),
    (error) => ({ ok: false as const, error }),
  );
  try {
    const deadline = performance.now() + 800;
    for (;;) {
      const [blocked] =
        await fixture.sql`select pid from pg_stat_activity where ${blocker}=any(pg_blocking_pids(pid)) limit 1`;
      if (blocked) break;
      if (performance.now() >= deadline)
        throw new Error('Refund did not wait behind terminal Round lock');
      await Bun.sleep(1);
    }
  } finally {
    release.resolve();
  }
  const state = await committed;
  const result = await settlement;
  if (!result.ok) throw result.error;
  return state;
}
