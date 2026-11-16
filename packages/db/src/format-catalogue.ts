import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { formats } from './schema/formats';
import { formatRevisions } from './schema/format-revisions';
import { formatPresets } from './schema/format-presets';

/** Published selectable revisions and their actual approved current presets. */
export const loadFormatCatalogue = async (
  tx: Pick<BunSQLDatabase, 'select'>,
) => {
  const rows = await tx
    .select({
      id: formats.id,
      name: formats.name,
      version: formats.currentVersion,
      role: formats.catalogRole,
      family: formats.family,
      leagues: formats.leagues,
      searchTerms: formats.searchTerms,
      sortOrder: formats.sortOrder,
      definition: formatRevisions.definition,
      rulesEdition: formatRevisions.rulesEdition,
      sourceUrl: formatRevisions.sourceUrl,
    })
    .from(formats)
    .innerJoin(
      formatRevisions,
      and(
        eq(formatRevisions.formatId, formats.id),
        eq(formatRevisions.version, formats.currentVersion),
      ),
    )
    .where(isNotNull(formats.catalogRole))
    .orderBy(asc(formats.sortOrder), asc(formats.id));
  const presets = await tx
    .select({
      formatId: formatPresets.formatId,
      version: formatPresets.version,
      formatVersion: formatPresets.formatVersion,
      config: formatPresets.config,
      rankedEligible: formatPresets.rankedEligible,
    })
    .from(formatPresets)
    .where(isNull(formatPresets.supersededAt));
  return rows.map(({ role, ...row }) => {
    const preset = presets.find(
      (p) => p.formatId === row.id && p.formatVersion === row.version,
    );
    if (!role || !preset)
      throw createAppError(
        'INVARIANT',
        `Catalog format ${row.id} has no current preset`,
      );
    return { ...row, role, preset };
  });
};
