import { sql } from 'drizzle-orm';

/** Adapter projection of the pure purge transition; no policy, inferred calls or new identity. */
export const analysisPurgeProjection = sql`jsonb_build_object(
  'kind','purged', 'historical', work->'historical',
  'request', case when work ? 'requestedAt'
    then work - array['kind','historical','lease','report','reason','completedAt']
    else null end,
  'completedAt', work->'completedAt',
  'purgedAt', to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;
