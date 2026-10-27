import { catalogFormats, type CatalogFormat } from './catalog-formats';

export const format = (id: string): CatalogFormat => {
  const found = catalogFormats.find((entry) => entry.id === id);
  if (!found) throw new Error(`no catalog format ${id}`);
  return found;
};

/** A preset's in-round prep per side, or null when it is off. */
export const prepMs = (id: string) => {
  const prep = format(id).preset.inRoundPrep;
  return prep.enabled ? prep.budgetMsPerSide : null;
};

/** "key side/slot minutes", the order a league's ballot reads. */
export const schedule = (id: string) =>
  format(id).definition.segments.map(
    (segment) =>
      `${segment.key} ${segment.side === 'affirmative' ? 'A' : 'N'}${segment.slot} ${segment.defaultDurationMs / 60_000}`,
  );
