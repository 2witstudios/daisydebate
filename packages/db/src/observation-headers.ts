import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  observationHeaderSchema,
  observationResourceSchema,
  type ObservationHeader,
  type ObservationResource,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';

/** One indexed MVCC statement, independent of finalized outbox horizons and observer count. */
export async function readObservationHeaders(
  database: Pick<BunSQLDatabase, 'execute'>,
  resources: readonly ObservationResource[],
): Promise<readonly ObservationHeader[]> {
  if (
    resources.length < 1 ||
    resources.length > 128 ||
    resources.some(
      (resource) => !observationResourceSchema.safeParse(resource).success,
    )
  )
    throw createAppError('VALIDATION');
  const rows = await database.execute(sql`
    select h.kind,h.resource_id as id,h.content_revision as "contentRevision",h.disclosure_revision as "disclosureRevision",h.purge_generation as "purgeGeneration"
    from public.resource_observation_headers h
    join jsonb_to_recordset(${JSON.stringify(resources)}::text::jsonb) as requested(kind text,id text)
      on h.kind=requested.kind and h.resource_id=requested.id
    order by h.kind,h.resource_id
  `);
  return rows.map((row) => {
    const result = observationHeaderSchema.safeParse({
      resource: { kind: row.kind, id: row.id },
      contentRevision: Number(row.contentRevision),
      disclosureRevision: Number(row.disclosureRevision),
      purgeGeneration: Number(row.purgeGeneration),
    });
    if (!result.success) throw createAppError('INFRASTRUCTURE');
    return result.data;
  });
}
