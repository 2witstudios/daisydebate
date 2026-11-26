import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { catalogFormats } from '@daisy/db/catalog-formats';

export type FormatTimes = {
  readonly name: string;
  /** "AC 6, CX 3, NC 7": each speech's short name and minutes, in order. */
  readonly speeches: string;
  readonly prepMinutes: number;
};

const minutes = (ms: number): number => ms / 60_000;

/**
 * A catalog format's speaking order and times as the page prints them, read
 * from the catalog so the page cannot drift from the round members get.
 * Numbered cross-examinations ("CX1") print as "CX".
 */
const formatTimes = (id: string): FormatTimes => {
  const format = catalogFormats.find((entry) => entry.id === id);
  if (format === undefined) throw new Error(`The format catalog has no ${id}`);
  const resolved = resolveRoomConfiguration(format.definition, format.preset);
  if (!resolved.ok) throw new Error(resolved.refusal.message);
  return {
    name: format.name,
    speeches: resolved.rules.segments
      .map(
        (segment) =>
          `${segment.type === 'cross_ex' ? 'CX' : segment.key} ${minutes(segment.durationMs)}`,
      )
      .join(', '),
    prepMinutes: format.preset.inRoundPrep.enabled
      ? minutes(format.preset.inRoundPrep.budgetMsPerSide)
      : 0,
  };
};

/** The two NCFCA debate formats Daisy runs, in the order the page lists them. */
export const ncfcaTimes = (): readonly FormatTimes[] => [
  formatTimes('ncfca-ld'),
  formatTimes('ncfca-tp'),
];
