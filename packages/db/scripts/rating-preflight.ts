import { SQL } from 'bun';

/** Operator-only nonmutating preflight BEFORE the three-ladder migration. */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const client = new SQL(url, { max: 1 });
try {
  const report = await client.begin(async (tx) => {
    await tx`set transaction read only`;
    const [counts] = await tx`select
      (select count(*)::integer from ratings) as standings,
      (select count(*)::integer from rating_changes) as postings,
      (select count(*)::integer from rounds where ladder_id is not null or competition_type='ranked' or preset_version is not null) as rated_rounds,
      (select count(*)::integer from rooms where competition_type='ranked' or preset_version is not null) as rated_rooms,
      (select count(*)::integer from seasons) as seasons`;
    const dependents =
      await tx`select conrelid::regclass::text as relation, conname as constraint,
      pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid in ('ratings'::regclass,'rating_changes'::regclass,'rounds'::regclass,'rooms'::regclass)
         or confrelid in ('ratings'::regclass,'rating_changes'::regclass,'rounds'::regclass,'rooms'::regclass)
      order by conrelid::regclass::text, conname`;
    const incompatible = [
      'standings',
      'postings',
      'rated_rounds',
      'rated_rooms',
    ].some((key) => Number(counts?.[key]) !== 0);
    return {
      migration: '20261028224402_three_rating_ladders',
      counts,
      dependents,
      disposition: incompatible
        ? 'REFUSE: retained rated state requires explicit disposition'
        : 'CLEAR: no existing rated state',
      activation:
        Number(counts?.seasons) === 0
          ? 'empty season catalog'
          : 'inspect existing season; activation refuses a competing season',
    };
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.disposition.startsWith('REFUSE')) process.exitCode = 1;
} finally {
  await client.close();
}
