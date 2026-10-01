import type { Card, CardUse, Segment } from '../../features/prep/card';
import { sampleTeamName } from './prep';

/** The owner's words-a-minute setting: a sample, shown in brackets. */
export const sampleReadingPace = 160;

const context = (text: string): Segment => ({ kind: 'context', text });
const read = (text: string): Segment => ({ kind: 'read', text });
const keep = (text: string): Segment => ({ kind: 'keep', text });

/** Source text layered around one read-aloud passage. */
export const layered = (
  passage: string,
  withKeep = true,
): readonly Segment[] => [
  context(
    '[Opening paragraph of the source. It sets out the question the source asks and the method it uses.] ',
  ),
  read(passage),
  ...(withKeep
    ? [
        keep(
          ' [A supporting sentence that stays in the card but is not read aloud.] ',
        ),
      ]
    : [context(' ')]),
  context(
    '[Closing paragraph of the source, kept so the passage can be read in context.]',
  ),
];

export const defaultPassage =
  '[The passage you would read aloud. It states the claim in the author’s own words and gives the reasoning behind it, in two or three sentences.]';

const team = { kind: 'team', teamName: sampleTeamName } as const;
const mine = { kind: 'private' } as const;

const uses = (...items: readonly CardUse[]): readonly CardUse[] => items;
const costUses = uses(
  {
    title: 'Affirmative, rights-based',
    detail: 'Case v4 · [Speech 1] · contention 2',
    href: '/prep/cases/aff-rights',
  },
  {
    title: 'Affirmative case: rights-based framework',
    detail: 'Brief · contention 2',
    href: '/prep/briefs/rights-framework',
  },
  {
    title: 'Negative block: implementation costs',
    detail: 'Brief · response 1',
    href: '/prep/briefs/neg-implementation-costs',
  },
);

/** Sample evidence cards; ids match the library's card items. */
export const sampleCards: readonly Card[] = [
  {
    id: 'cost-estimates',
    tagLine: 'Cost estimates depend on assumed take-up',
    author: '[Author A]',
    year: '[year]',
    qualifications: '[qualifications, institution]',
    publication: '[Publication]',
    title: '[Title of the source]',
    published: '[yyyy-mm-dd]',
    url: 'https://example.org/[source-path]',
    retrieved: '[yyyy-mm-dd]',
    credibilityNotes:
      '[Why you trust this source, what it assumes, and where an opponent is likely to push back.]',
    visibility: team,
    uses: costUses,
    versions: [
      {
        version: 3,
        label: 'Highlight changed',
        when: '2 days ago, by you',
        tags: ['costs', 'implementation', '[tag]'],
        segments: layered(defaultPassage),
      },
      {
        version: 2,
        label: 'Tags edited',
        when: 'Last week',
        tags: ['costs', 'implementation'],
        segments: layered(defaultPassage, false),
      },
      {
        version: 1,
        label: 'Saved from a link',
        when: '[yyyy-mm-dd]',
        tags: [],
        segments: layered(defaultPassage, false),
      },
    ],
  },
  ...(
    [
      [
        'pilot-results',
        'Pilot results do not transfer across regions',
        '[Author B]',
        '[Journal]',
        ['evidence quality'],
        1,
      ],
      [
        'framework-institutions',
        'The framework applies to institutions, not only persons',
        '[Author C]',
        '[Book]',
        ['framework', 'rights'],
        0,
      ],
      [
        'rights-survive-policy',
        'Rights claims survive changes in policy',
        '[Author D]',
        '[Journal]',
        ['rights'],
        2,
      ],
      [
        'enforcement-sources',
        'Sources on enforcement',
        '[Author E]',
        '[Outlet]',
        ['implementation'],
        1,
      ],
    ] as const
  ).map(([id, tagLine, author, publication, tags, used]): Card => ({
    id,
    tagLine,
    author,
    year: '[year]',
    qualifications: '[qualifications, institution]',
    publication,
    title: '[Title of the source]',
    published: '[yyyy-mm-dd]',
    url: 'https://example.org/[source-path]',
    retrieved: '[yyyy-mm-dd]',
    credibilityNotes: '[Why you trust this source.]',
    visibility: id === 'enforcement-sources' ? team : mine,
    uses:
      used === 0
        ? []
        : [
            {
              title: 'Affirmative case: rights-based framework',
              detail: 'Brief · contention 1',
              href: '/prep/briefs/rights-framework',
            },
            {
              title: 'Affirmative, rights-based',
              detail: 'Case v4 · [Speech 1]',
              href: '/prep/cases/aff-rights',
            },
          ].slice(0, used),
    versions: [
      {
        version: 1,
        label: 'Saved from a link',
        when: '[yyyy-mm-dd]',
        tags,
        segments: layered(defaultPassage, false),
      },
    ],
  })),
];
