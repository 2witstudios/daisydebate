import type { LibraryItem } from '../../features/prep/library-item';
import type { LibraryQuery } from '../../features/prep/library-query';

/**
 * Sample Prep data. Bracketed names, authors and motions are placeholders,
 * not real people or motions. Dates hang off the injected `now` so the
 * relative labels read the same whenever the page renders.
 */
const daysBefore = (now: string, days: number): string =>
  new Date(Date.parse(now) - days * 86_400_000).toISOString();

export const sampleTeamName = '[Team name]';
const team = { kind: 'team', teamName: sampleTeamName } as const;
const mine = { kind: 'private' } as const;

export const sampleLibrary = (now: string): readonly LibraryItem[] => [
  {
    kind: 'brief',
    id: 'rights-framework',
    title: 'Affirmative case: rights-based framework',
    motion: '[Motion A]',
    side: 'aff',
    contentions: 4,
    tags: ['framework', 'rights'],
    visibility: team,
    editedAt: daysBefore(now, 2),
    openedAt: daysBefore(now, 0),
    usedIn: 2,
  },
  {
    kind: 'card',
    id: 'cost-estimates',
    title: 'Cost estimates depend on assumed take-up',
    author: '[Author A]',
    publication: '[Publication]',
    year: '[year]',
    outlet: '[Outlet]',
    passage:
      '[The passage you would read aloud. It states the claim in the author’s own words: the cost estimates depend on assumed take-up.]',
    tags: ['costs', 'implementation'],
    visibility: team,
    editedAt: daysBefore(now, 2),
    openedAt: daysBefore(now, 1),
    usedIn: 3,
  },
  {
    kind: 'case',
    id: 'aff-rights',
    title: 'Affirmative, rights-based',
    motion: '[Motion A]',
    side: 'aff',
    version: 4,
    tags: ['aff', 'rights'],
    visibility: team,
    editedAt: daysBefore(now, 2),
    openedAt: daysBefore(now, 2),
    usedIn: 0,
  },
  {
    kind: 'card',
    id: 'pilot-results',
    title: 'Pilot results do not transfer across regions',
    author: '[Author B]',
    publication: '[Journal]',
    year: '[year]',
    outlet: '[Journal]',
    passage:
      '[The passage you would read aloud: pilot results were not reproduced in other regions.]',
    tags: ['evidence quality'],
    visibility: mine,
    editedAt: daysBefore(now, 9),
    openedAt: daysBefore(now, 6),
    usedIn: 1,
  },
  {
    kind: 'brief',
    id: 'neg-implementation-costs',
    title: 'Negative block: implementation costs',
    motion: '[Motion A]',
    side: 'neg',
    contentions: 3,
    tags: ['costs', 'implementation'],
    visibility: mine,
    editedAt: daysBefore(now, 8),
    openedAt: daysBefore(now, 5),
    usedIn: 1,
  },
  {
    kind: 'brief',
    id: 'framing-pack',
    title: 'Framing pack: burden and standards',
    motion: '[Motion B]',
    side: 'aff',
    contentions: 2,
    tags: ['framing'],
    visibility: mine,
    editedAt: daysBefore(now, 22),
    openedAt: daysBefore(now, 15),
    usedIn: 1,
  },
  {
    kind: 'brief',
    id: 'opening-statements',
    title: 'Opening statements, [Motion B]',
    motion: '[Motion B]',
    side: 'neg',
    contentions: 2,
    tags: ['framing'],
    visibility: team,
    editedAt: daysBefore(now, 9),
    openedAt: daysBefore(now, 9),
    usedIn: 0,
  },
  {
    kind: 'card',
    id: 'framework-institutions',
    title: 'The framework applies to institutions, not only persons',
    author: '[Author C]',
    publication: '[Book]',
    year: '[year]',
    outlet: '[Publisher]',
    passage:
      '[The passage you would read aloud: the framework applies to institutions, not only to persons.]',
    tags: ['framework', 'rights'],
    visibility: mine,
    editedAt: daysBefore(now, 12),
    openedAt: daysBefore(now, 12),
    usedIn: 0,
  },
  {
    kind: 'card',
    id: 'rights-survive-policy',
    title: 'Rights claims survive changes in policy',
    author: '[Author D]',
    publication: '[Journal]',
    year: '[year]',
    outlet: '[Journal]',
    passage:
      '[The passage you would read aloud: a rights claim does not lapse when policy changes.]',
    tags: ['rights'],
    visibility: mine,
    editedAt: daysBefore(now, 30),
    openedAt: daysBefore(now, 30),
    usedIn: 2,
  },
  {
    kind: 'card',
    id: 'enforcement-sources',
    title: 'Sources on enforcement',
    author: '[Author E]',
    publication: '[Outlet]',
    year: '[year]',
    outlet: '[Outlet]',
    passage:
      '[The passage you would read aloud: enforcement paths decide whether a right is realised.]',
    tags: ['implementation'],
    visibility: team,
    editedAt: daysBefore(now, 21),
    openedAt: daysBefore(now, 21),
    usedIn: 1,
  },
  {
    kind: 'case',
    id: 'neg-costs-first',
    title: 'Negative, costs first',
    motion: '[Motion A]',
    side: 'neg',
    version: 2,
    tags: ['neg', 'costs'],
    visibility: mine,
    editedAt: daysBefore(now, 8),
    openedAt: daysBefore(now, 8),
    usedIn: 0,
  },
];

/** Saved searches: a name and the filters they run. */
export const sampleSavedSearches: readonly {
  readonly id: string;
  readonly name: string;
  readonly query: Partial<LibraryQuery>;
}[] = [
  {
    id: 'cost-objections',
    name: 'Cost objections, [Motion A]',
    query: { tag: 'costs', motion: '[Motion A]' },
  },
  { id: 'tagged-rights', name: 'Tagged [rights]', query: { tag: 'rights' } },
  {
    id: 'framework-aff',
    name: 'Framework, Aff',
    query: { tag: 'framework', side: 'aff' },
  },
];

export const sampleTeamSummaries: readonly {
  readonly id: string;
  readonly name: string;
  readonly memberHandles: readonly string[];
  readonly sharedCount: number;
}[] = [
  {
    id: 'sample-team',
    name: sampleTeamName,
    memberHandles: ['debater-a', 'debater-b', 'debater-c', 'debater-d'],
    sharedCount: 5,
  },
];
