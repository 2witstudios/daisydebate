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

/** A new room starts on Value, Daisy's default standard (FMT-3). */
export const defaultChoice = <T extends CatalogEntry>(catalog: readonly T[]) =>
  catalog.find((entry) => entry.formatId === 'value') ??
  standardOptions(catalog)[0] ??
  catalog[0];

/** The create-room selection for a catalog choice, pinned to its preset. */
export const casualSelection = (choice: RoomCatalogChoice) => ({
  kind: 'catalog' as const,
  formatId: choice.formatId,
  formatVersion: choice.formatVersion,
  presetVersion: choice.preset.version,
  competitionType: 'casual' as const,
});

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

const familyOrder: readonly Family[] = families;

/** The native select's groups: Daisy's standards first, then league rules by family. */
export function catalogGroups<T extends CatalogEntry>(
  catalog: readonly T[],
  familyLabel: Readonly<Record<Family, string>>,
): readonly { readonly label: string; readonly options: readonly T[] }[] {
  return [
    { label: 'Daisy standards', options: standardOptions(catalog) },
    ...familyOrder.map((family) => ({
      label: `League rules · ${familyLabel[family]}`,
      options: browseTemplates(catalog, { family, query: '' }).flatMap(
        (group) => group.templates,
      ),
    })),
  ].filter((group) => group.options.length > 0);
}

type BrowserTab = 'standard' | Family;

/** The browse dialog's tabs: standards when offered, then each family present. */
export function browserTabs(
  catalog: readonly CatalogEntry[],
  familyLabel: Readonly<Record<Family, string>>,
): readonly { readonly key: BrowserTab; readonly label: string }[] {
  return [
    ...(standardOptions(catalog).length
      ? [{ key: 'standard' as const, label: 'Daisy standards' }]
      : []),
    ...familyOrder
      .filter((family) => catalog.some((entry) => entry.family === family))
      .map((family) => ({ key: family, label: familyLabel[family] })),
  ];
}

/** What the browse dialog lists: every match while searching, else the open tab. */
export function browserListing<T extends CatalogEntry>(
  catalog: readonly T[],
  { query, tab }: { readonly query: string; readonly tab: BrowserTab },
): readonly T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length)
    return [
      ...standardOptions(catalog).filter((entry) => matches(entry, words)),
      ...browseTemplates(catalog, { family: 'policy', query }).flatMap(
        (group) => group.templates,
      ),
    ];
  return tab === 'standard'
    ? standardOptions(catalog)
    : browseTemplates(catalog, { family: tab, query: '' }).flatMap(
        (group) => group.templates,
      );
}
