import type { FormatDefinition, RoomConfig } from '@daisy/protocol';
import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { formatPresets } from './schema/format-presets';
import { formatRevisions } from './schema/format-revisions';
import { formats } from './schema/formats';
import { instrumented, type DatabaseEventSink } from './instrumented';

export type FormatRevisionRecord = {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly definition: FormatDefinition;
};

export type FormatPresetRecord = {
  readonly formatId: string;
  readonly version: number;
  readonly formatVersion: number;
  readonly config: RoomConfig;
};

/** Shared current-revision join used by single-format reads and the Room catalog. */
export const currentFormatRevisions = (client: BunSQLDatabase) =>
  client
    .select({
      id: formats.id,
      name: formats.name,
      version: formats.currentVersion,
      definition: formatRevisions.definition,
    })
    .from(formats)
    .innerJoin(
      formatRevisions,
      and(
        eq(formatRevisions.formatId, formats.id),
        eq(formatRevisions.version, formats.currentVersion),
      ),
    );

/** The exact (format, revision, preset) a selection names. */
export type SelectionTuple = {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number;
};

/** What the selection policy judges; shaped like the engine's FormatSelectionFacts. */
export type FormatSelectionFactsRecord = {
  readonly format: {
    readonly id: string;
    readonly catalogOwned: boolean;
    readonly role: 'standard' | 'template' | null;
    readonly currentVersion: number;
  };
  readonly definition: FormatDefinition;
  readonly preset: {
    readonly version: number;
    readonly formatVersion: number;
    readonly config: RoomConfig;
    readonly rankedEligible: boolean;
    readonly current: boolean;
  };
};

/**
 * The stored facts for one selection tuple, or null when any part is
 * absent. Read FOR SHARE so a selection inside a write transaction
 * serializes with publication, which locks the format row FOR UPDATE. It
 * reports what is stored and never substitutes the current preset: the
 * pure policy decides.
 */
export async function readFormatSelectionFacts(
  client: BunSQLDatabase,
  { formatId, formatVersion, presetVersion }: SelectionTuple,
): Promise<FormatSelectionFactsRecord | null> {
  const [row] = await client
    .select({
      id: formats.id,
      createdByActorId: formats.createdByActorId,
      role: formats.catalogRole,
      currentVersion: formats.currentVersion,
      definition: formatRevisions.definition,
      presetVersion: formatPresets.version,
      presetFormatVersion: formatPresets.formatVersion,
      config: formatPresets.config,
      rankedEligible: formatPresets.rankedEligible,
      supersededAt: formatPresets.supersededAt,
    })
    .from(formats)
    .innerJoin(
      formatRevisions,
      and(
        eq(formatRevisions.formatId, formats.id),
        eq(formatRevisions.version, formatVersion),
      ),
    )
    .innerJoin(
      formatPresets,
      and(
        eq(formatPresets.formatId, formats.id),
        eq(formatPresets.version, presetVersion),
      ),
    )
    .where(eq(formats.id, formatId))
    .limit(1)
    .for('share');
  if (!row) return null;
  return {
    format: {
      id: row.id,
      catalogOwned: row.createdByActorId === null,
      role: row.role,
      currentVersion: row.currentVersion,
    },
    definition: row.definition,
    preset: {
      version: row.presetVersion,
      formatVersion: row.presetFormatVersion,
      config: row.config,
      rankedEligible: row.rankedEligible,
      current: row.supersededAt === null,
    },
  };
}

/**
 * The formats area (ADR 0058 §2a): reads over the identity table, its
 * immutable revisions and the sanctioned presets. Publishing a revision or
 * approving a preset ships in migrations (reference data, ADR 0038), so
 * there is no runtime write path here yet — the first one lands with its
 * consumer.
 */
export const formatOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** The format's current definition revision, or null when absent. */
  async getFormat(id: string): Promise<FormatRevisionRecord | null> {
    return instrumented(eventSink, 'getFormat', async () => {
      const [row] = await currentFormatRevisions(database)
        .where(eq(formats.id, id))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        definition: row.definition,
      };
    });
  },

  /**
   * The current approved preset for a format, or null when the
   * format has none — the refusal `resolveRoom` turns into
   * preset-unavailable for ranked rooms.
   */
  async getCurrentPreset(formatId: string): Promise<FormatPresetRecord | null> {
    return instrumented(eventSink, 'getCurrentPreset', async () => {
      const [row] = await database
        .select({
          formatId: formatPresets.formatId,
          version: formatPresets.version,
          formatVersion: formatPresets.formatVersion,
          config: formatPresets.config,
        })
        .from(formatPresets)
        .where(
          and(
            eq(formatPresets.formatId, formatId),
            isNull(formatPresets.supersededAt),
          ),
        )
        .limit(1);
      if (!row) return null;
      return row as FormatPresetRecord;
    });
  },

  /** The facts a selection policy judges for one tuple (see readFormatSelectionFacts). */
  async getFormatSelectionFacts(
    tuple: SelectionTuple,
  ): Promise<FormatSelectionFactsRecord | null> {
    return instrumented(eventSink, 'getFormatSelectionFacts', () =>
      readFormatSelectionFacts(database, tuple),
    );
  },

  /**
   * The historical definition revision a round or preset pinned, for
   * `assertRatedRoundIntegrity` and provenance reads. Refuses when absent:
   * a pinned version that no longer resolves is corruption.
   */
  async getFormatRevision(
    formatId: string,
    version: number,
  ): Promise<FormatDefinition> {
    return instrumented(eventSink, 'getFormatRevision', async () => {
      const [row] = await database
        .select({ definition: formatRevisions.definition })
        .from(formatRevisions)
        .where(
          and(
            eq(formatRevisions.formatId, formatId),
            eq(formatRevisions.version, version),
          ),
        )
        .limit(1);
      if (!row)
        throw createAppError(
          'INVARIANT',
          `No format revision ${formatId}@${version}`,
        );
      return row.definition;
    });
  },
});
