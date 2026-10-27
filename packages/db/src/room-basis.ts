import { and, eq } from 'drizzle-orm';
import type { RoomAssemblyState } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { Tx } from './room-command-facts';
import { formats } from './schema/formats';
import { formatPresets } from './schema/format-presets';
import { formatRevisions } from './schema/format-revisions';
import type { rooms } from './schema/rooms';

/**
 * The catalog preset a room is based on, with its pinned revision, for
 * standing (FMT-1). A basis whose format left the catalog keeps its pinned
 * provenance but is no longer a standard.
 */
export const basisSource = async (
  tx: Tx,
  row: typeof rooms.$inferSelect,
): Promise<RoomAssemblyState['basis']> => {
  if (row.basisFormatId === null || row.basisPresetVersion === null)
    return null;
  const [basis] = await tx
    .select({
      formatVersion: formatPresets.formatVersion,
      config: formatPresets.config,
      name: formats.name,
      role: formats.catalogRole,
      definition: formatRevisions.definition,
    })
    .from(formatPresets)
    .innerJoin(formats, eq(formats.id, formatPresets.formatId))
    .innerJoin(
      formatRevisions,
      and(
        eq(formatRevisions.formatId, formatPresets.formatId),
        eq(formatRevisions.version, formatPresets.formatVersion),
      ),
    )
    .where(
      and(
        eq(formatPresets.formatId, row.basisFormatId),
        eq(formatPresets.version, row.basisPresetVersion),
      ),
    );
  if (!basis) throw createAppError('INVARIANT');
  return {
    formatId: row.basisFormatId,
    presetVersion: row.basisPresetVersion,
    formatVersion: basis.formatVersion,
    name: basis.name,
    role: basis.role ?? 'template',
    definition: basis.definition,
    config: basis.config,
  };
};
