import type { RoomCatalogChoice } from '@daisy/protocol';
import { roundLength, shapeLabel } from '../debate-room/vocabulary';

type Family = 'policy' | 'value' | 'parli' | 'other';

type CatalogEntry = {
  readonly formatId: string;
  readonly label: string;
  readonly role: 'standard' | 'template';
  readonly family: Family | null;
  readonly leagues: readonly string[];
  readonly searchTerms: string;
  readonly sortOrder: number;
};

const families: readonly Family[] = ['policy', 'value', 'parli', 'other'];

const bySortOrder = <T extends CatalogEntry>(entries: readonly T[]) =>
  [...entries].sort((a, b) => a.sortOrder - b.sortOrder);

/** Room setup's first options: Daisy's standards, in catalog order. */
export function standardOptions<T extends CatalogEntry>(
  catalog: readonly T[],
): readonly T[] {
  return bySortOrder(catalog.filter((entry) => entry.role === 'standard'));
}

const matches = (entry: CatalogEntry, words: readonly string[]) => {
  const haystack =
    `${entry.label} ${entry.leagues.join(' ')} ${entry.searchTerms}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

/**
 * The league browser inside Custom. With no search it shows the chosen
 * family's templates; a search spans every family, so a league name finds
 * its formats wherever they sit. Standards are never listed here.
 */
export function browseTemplates<T extends CatalogEntry>(
  catalog: readonly T[],
  { family, query }: { readonly family: Family; readonly query: string },
): readonly { readonly family: Family; readonly templates: readonly T[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const templates = bySortOrder(
    catalog.filter(
      (entry) =>
        entry.role === 'template' &&
        (words.length ? matches(entry, words) : entry.family === family),
    ),
  );
  return families
    .map((group) => ({
      family: group,
      templates: templates.filter((entry) => entry.family === group),
    }))
    .filter((group) => group.templates.length > 0);
}

/** Each speech's duration at the choice's canonical preset. */
export const presetSpeechMs = (choice: RoomCatalogChoice) =>
  choice.definition.segments.map(
    (segment) =>
      choice.preset.config.speechTiming.segmentDurationOverrides[segment.key] ??
      segment.defaultDurationMs,
  );

/** "1v1 · about 34 min": a catalog choice at its canonical preset. */
export function choiceSummary(choice: RoomCatalogChoice): string {
  const { inRoundPrep, speechTiming } = choice.preset.config;
  return `${shapeLabel(choice.definition.seats)} · ${roundLength({
    speechesMs: presetSpeechMs(choice),
    countdownMs: speechTiming.countdownMs,
    prepPerSideMs: inRoundPrep.enabled ? inRoundPrep.budgetMsPerSide : null,
  })}`;
}
