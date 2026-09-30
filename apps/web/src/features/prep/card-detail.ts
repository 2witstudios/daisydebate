import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import {
  currentVersion,
  readView,
  readWords,
  type Card,
  type CardUse,
  type CardVersion,
  type Segment,
} from './card';
import { formatClock, readSeconds } from './reading-time';

const views = ['read', 'full', 'cite'] as const;
type CardDetailTab = (typeof views)[number];

export type CardDetailQuery = {
  readonly view: CardDetailTab;
  /** A past version to look at; 0 is the current one. */
  readonly version: number;
};

const schema = z.object({
  view: z.enum(views).catch('read'),
  version: z.coerce.number().int().min(1).max(9999).catch(0),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseCardDetailQuery(params: SearchParams): CardDetailQuery {
  return schema.parse({
    view: first(params['view']),
    version: first(params['version']) ?? 0,
  });
}

export function cardHref(id: string, query: CardDetailQuery): string {
  const search = new URLSearchParams();
  if (query.view !== 'read') search.set('view', query.view);
  if (query.version !== 0) search.set('version', String(query.version));
  const text = search.toString();
  return text === '' ? `/prep/cards/${id}` : `/prep/cards/${id}?${text}`;
}

const tabLabels: Readonly<Record<CardDetailTab, string>> = {
  read: 'Read view',
  full: 'Full source',
  cite: 'Citation',
};

export type CardDetailView = {
  readonly card: Card;
  readonly query: CardDetailQuery;
  readonly tabs: readonly {
    readonly id: CardDetailTab;
    readonly label: string;
    readonly href: string;
  }[];
  /** The version on screen: the current one unless a past one was asked for. */
  readonly shown: CardVersion;
  /** Set when looking at a past version. */
  readonly pastVersion: {
    readonly version: number;
    readonly currentHref: string;
  } | null;
  readonly readSegments: readonly Segment[];
  readonly readClock: string;
  readonly provenance: readonly (readonly [string, string])[];
  readonly uses: readonly CardUse[];
  readonly versionLinks: readonly {
    readonly version: number;
    readonly label: string;
    readonly when: string;
    readonly current: boolean;
    readonly href: string;
  }[];
  readonly deleteHref: string;
};

/** The card detail's one driver: a card and the URL state to a view model. */
export function cardDetailView(
  card: Card,
  query: CardDetailQuery,
  pace: number,
): CardDetailView {
  const latest = currentVersion(card);
  const asked = card.versions.find((v) => v.version === query.version);
  const shown = asked ?? latest;
  const viewing = shown.version;
  const at = (over: Partial<CardDetailQuery>) =>
    cardHref(card.id, {
      ...query,
      version: asked === undefined ? 0 : viewing,
      ...over,
    });
  return {
    card,
    query: { ...query, version: asked === undefined ? 0 : viewing },
    tabs: views.map((id) => ({
      id,
      label: tabLabels[id],
      href: at({ view: id }),
    })),
    shown,
    pastVersion:
      viewing === latest.version
        ? null
        : {
            version: viewing,
            currentHref: cardHref(card.id, { view: query.view, version: 0 }),
          },
    readSegments: readView(shown.segments),
    readClock: formatClock(readSeconds(readWords(shown.segments), pace)),
    provenance: [
      ['Author', `${card.author}, ${card.qualifications}`],
      ['Publication', card.publication],
      ['Title', card.title],
      ['Published', card.published === '' ? 'Not given' : card.published],
      ['Retrieved', `${card.retrieved} by you`],
    ],
    uses: card.uses,
    versionLinks: card.versions.map((v) => ({
      version: v.version,
      label: v.label,
      when: v.when,
      current: v.version === latest.version,
      href:
        v.version === latest.version
          ? cardHref(card.id, { view: query.view, version: 0 })
          : cardHref(card.id, { view: query.view, version: v.version }),
    })),
    deleteHref: `/prep/cards/${card.id}/delete`,
  };
}
