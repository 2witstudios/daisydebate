/**
 * Runs on a deployed web machine (piped over `fly ssh console`, never
 * imported): reads one Round's frozen transcript and its ballots inside a
 * READ ONLY transaction and prints them as one marked JSON line. With
 * JB_FIND it instead lists Rounds whose ballot reasons contain that text,
 * and with JB_PASSES every coherency-judged Round's first pass and final
 * ballot (ADR 0125).
 */
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { readLockedFrozenRoundTranscript } from '@daisy/db/frozen-transcript';

const MARK = 'JUDGE_BENCH_JSON:';
const client = new SQL(process.env['DATABASE_URL']!, { max: 1 });
const db = drizzle({ client });

const rows = async <T>(tx: typeof db, query: ReturnType<typeof sql>) =>
  (await tx.execute(query)) as unknown as T[];

try {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    if (process.env['JB_LIST'])
      return rows(
        tx as unknown as typeof db,
        sql`select r.id, r.resolution, r.completed_at,
                   count(b.id)::int as ballots,
                   string_agg(b.winner, ',') as winners,
                   string_agg(left(b.reason, 140), ' || ') as reasons,
                   (select count(*) from utterances u where u.round_id = r.id)::int as lines
            from rounds r join ballots b on b.round_id = r.id
            group by r.id order by r.completed_at desc nulls last limit 40`,
      );
    if (process.env['JB_PASSES'])
      return rows(
        tx as unknown as typeof db,
        sql`select r.id as "roundId", r.resolution, j.first_ballot as first,
                   j.first_ballot_failed as "firstFailed",
                   json_build_object('winner', b.winner, 'scores', b.scores) as final
            from round_judging_jobs j
            join rounds r on r.id = j.round_id
            join ballots b on b.id = j.result_ballot_id
            where j.first_ballot is not null or j.first_ballot_failed
            order by b.submitted_at desc limit 100`,
      );
    const find = process.env['JB_FIND'];
    if (find)
      return rows(
        tx as unknown as typeof db,
        sql`select r.id, r.resolution, r.completed_at, left(b.reason, 160) as reason
            from ballots b join rounds r on r.id = b.round_id
            where b.reason ilike ${`%${find}%`}
            order by r.completed_at desc nulls last limit 10`,
      );
    const roundId = process.env['JB_ROUND']!;
    const reader = tx as unknown as typeof db;
    const [round] = await rows<{ id: string; resolution: string | null }>(
      reader,
      sql`select id, resolution from rounds where id = ${roundId}`,
    );
    if (!round) throw new Error(`no round ${roundId}`);
    const participants = await rows(
      reader,
      sql`select id, role, slot from round_participants where round_id = ${roundId}`,
    );
    const segments = await rows(
      reader,
      sql`select id, sequence from round_segments where round_id = ${roundId}`,
    );
    const ballots = await rows(
      reader,
      sql`select b.judge_participant_id, b.winner, b.scores, b.reason, b.feedback,
                 b.freeze_revision, j.model
            from ballots b
            left join round_judging_jobs j on j.result_ballot_id = b.id
            where b.round_id = ${roundId} order by b.submitted_at`,
    );
    const frozen = await readLockedFrozenRoundTranscript(tx, roundId);
    return { round: { ...round, participants, segments }, frozen, ballots };
  });
  console.log(MARK + JSON.stringify(result));
} finally {
  await client.close();
}
