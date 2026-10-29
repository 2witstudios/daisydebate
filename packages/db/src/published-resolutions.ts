import { asc, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  publishedResolutionSchema,
  type PublishedResolution,
} from '@daisy/protocol';
import { publishedResolutions } from './schema/published-resolutions';

const publication = (
  row: typeof publishedResolutions.$inferSelect,
): PublishedResolution =>
  publishedResolutionSchema.parse({
    id: row.id,
    kind: row.kind,
    text: row.text,
    provenance: row.provenance,
    edition: row.edition,
    theme: row.theme,
    publishedAt: row.publishedAt.toISOString(),
  });

export const readPublishedResolutions = async (
  database: BunSQLDatabase,
): Promise<readonly PublishedResolution[]> =>
  (
    await database
      .select()
      .from(publishedResolutions)
      .where(isNull(publishedResolutions.retiredAt))
      .orderBy(asc(publishedResolutions.kind))
  ).map(publication);

/** Called again under the creation transaction's shared publication lock. */
export async function readPublishedResolution(
  database: BunSQLDatabase,
  id: string,
  kind: 'policy' | 'value',
): Promise<PublishedResolution | null> {
  const rows = await database.execute(
    sql`select id,kind,text,provenance,edition,theme,published_at as "publishedAt" from public.daisy_current_published_resolution(${id},${kind})`,
  );
  const row = rows[0];
  if (!row) return null;
  return publishedResolutionSchema.parse({
    ...row,
    publishedAt: new Date(row.publishedAt as Date).toISOString(),
  });
}
