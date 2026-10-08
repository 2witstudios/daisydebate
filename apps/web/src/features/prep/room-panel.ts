import { currentVersion, readWords, type Card } from './cards/card';
import {
  blockClock,
  latestVersion,
  type Case,
  type Speech,
} from './cases/case';
import { findBlockSources } from './cards/block-sources';
import { getCard } from './cards/get-card';
import { getCase, listCases } from './cases/get-case';
import { caseChangedElsewhere, type Notice } from './notices';
import { formatClock, readSeconds } from './reading-time';
import {
  roomPanelHref,
  type PanelTab,
  type RoomPanelQuery,
} from './room-panel-query';

export type PanelCard = {
  readonly id: string;
  readonly title: string;
  /** "[Author C] [year] · 0:13". */
  readonly meta: string;
  readonly href: string;
};

type SpeechRow = {
  readonly id: string;
  readonly label: string;
  readonly clock: string;
  readonly current: boolean;
};

export type PinnedPanel = {
  readonly caseTitle: string;
  readonly version: number;
  readonly notice: Notice | null;
  readonly changeHref: string;
  readonly body:
    | {
        readonly kind: 'card';
        readonly card: Card;
        readonly clock: string;
        readonly sendAsk: boolean;
        readonly backHref: string;
        readonly sendHref: string;
        readonly cancelHref: string;
      }
    | {
        readonly kind: 'tabs';
        readonly tab: PanelTab;
        readonly tabs: readonly { id: PanelTab; label: string; href: string }[];
        readonly speech: {
          readonly label: string;
          readonly rows: readonly SpeechRow[];
          readonly claim: string | null;
          readonly nextCard: string | null;
        };
        readonly cards: readonly PanelCard[];
        readonly search: {
          readonly q: string;
          readonly results: readonly PanelCard[];
        };
      };
};

export type RoomPanelView = {
  readonly query: RoomPanelQuery;
  readonly hideHref: string;
  readonly showHref: string;
  readonly openHref: string;
  readonly closeHref: string;
  /** Compact line for the phone's collapsed sheet. */
  readonly summary: string;
  readonly body:
    | {
        readonly kind: 'choose';
        readonly options: readonly { value: string; label: string }[];
      }
    | {
        readonly kind: 'search-only';
        readonly search: {
          readonly q: string;
          readonly results: readonly PanelCard[];
        };
      }
    | ({ readonly kind: 'pinned' } & PinnedPanel);
};

const panelCard = (card: Card, pace: number): PanelCard => ({
  id: card.id,
  title: card.tagLine,
  meta: `${card.author} ${card.year} · ${formatClock(readSeconds(readWords(currentVersion(card).segments), pace))}`,
  href: `/prep/cards/${card.id}`,
});

const cardsIn = (
  speeches: readonly Speech[],
  pace: number,
): readonly PanelCard[] =>
  speeches
    .flatMap((s) => s.blocks)
    .flatMap((b) => {
      const card =
        b.href === undefined
          ? undefined
          : getCard(b.href.split('/').at(-1) ?? '');
      return card === undefined ? [] : [panelCard(card, pace)];
    });

function searchResults(
  q: string,
  pace: number,
  now: string,
): readonly PanelCard[] {
  return findBlockSources(q, now, pace)
    .filter((s) => s.kind === 'card')
    .flatMap((s) => {
      const card = getCard(s.id);
      return card === undefined ? [] : [panelCard(card, pace)];
    });
}

function speechPanel(speech: Speech | undefined, pace: number) {
  const blocks = speech?.blocks ?? [];
  const found = blocks.findIndex((b) => b.claim !== undefined);
  const at = found === -1 ? 0 : found;
  return {
    label: speech?.label ?? '[Speech 1]',
    rows: blocks.map((b, index) => ({
      id: b.id,
      label: b.title,
      clock: blockClock(b, pace),
      current: index === at,
    })),
    claim: blocks[at]?.claim ?? null,
    nextCard:
      blocks.slice(at + 1).find((b) => b.kind === 'card' && b.removed !== true)
        ?.title ?? null,
  };
}

function pinnedPanel(
  c: Case,
  query: RoomPanelQuery,
  pace: number,
  now: string,
): PinnedPanel {
  const latest = latestVersion(c).version;
  const version = query.version === 0 ? latest : query.version;
  const snapshot =
    c.versions.find((v) => v.version === version) ?? latestVersion(c);
  const stale = snapshot.version < latest && !query.keep;
  const base = {
    pin: c.id,
    version: query.version,
  } satisfies Partial<RoomPanelQuery>;
  const tabs = (['speech', 'cards', 'search'] as const).map((id) => ({
    id,
    label: id === 'speech' ? 'Speech' : id === 'cards' ? 'Cards' : 'Search',
    href: roomPanelHref({ ...query, tab: id, card: '', send: false }),
  }));
  const head = {
    caseTitle: c.title,
    version: snapshot.version,
    changeHref: roomPanelHref({ open: query.open }),
    notice: stale
      ? caseChangedElsewhere(
          snapshot.version,
          latest,
          roomPanelHref({ ...query, version: latest, keep: false }),
          roomPanelHref({ ...query, keep: true }),
        )
      : null,
  };
  const card = query.card === '' ? undefined : getCard(query.card);
  if (card !== undefined)
    return {
      ...head,
      body: {
        kind: 'card',
        card,
        clock: formatClock(
          readSeconds(readWords(currentVersion(card).segments), pace),
        ),
        sendAsk: query.send,
        backHref: roomPanelHref({ ...query, ...base, card: '', send: false }),
        sendHref: roomPanelHref({ ...query, send: true }),
        cancelHref: roomPanelHref({ ...query, send: false }),
      },
    };
  return {
    ...head,
    body: {
      kind: 'tabs',
      tab: query.tab,
      tabs,
      speech: speechPanel(snapshot.speeches[0], pace),
      cards: cardsIn(snapshot.speeches, pace),
      search: {
        q: query.q,
        results: query.q === '' ? [] : searchResults(query.q, pace, now),
      },
    },
  };
}

/**
 * The in-debate prep panel's one driver: the seat's pinned case (carried in
 * the URL until a server holds it) and the open tab or card to a view model.
 * The panel is rendered for the seat's owner alone; nothing here is shared
 * with the room.
 */
export function roomPanelView(
  query: RoomPanelQuery,
  pace: number,
  now: string,
): RoomPanelView {
  const pinned =
    query.pin === '' || query.pin === 'none' ? undefined : getCase(query.pin);
  const common = {
    query,
    hideHref: roomPanelHref({ ...query, hidden: true }),
    showHref: roomPanelHref({ ...query, hidden: false }),
    openHref: roomPanelHref({ ...query, open: true }),
    closeHref: roomPanelHref({ ...query, open: false }),
  };
  if (pinned !== undefined) {
    const panel = pinnedPanel(pinned, query, pace, now);
    return {
      ...common,
      summary:
        panel.body.kind === 'tabs'
          ? `Now: ${panel.body.speech.label}`
          : 'Reading a card',
      body: { kind: 'pinned', ...panel },
    };
  }
  if (query.pin === 'none')
    return {
      ...common,
      summary: 'Search only',
      body: {
        kind: 'search-only',
        search: {
          q: query.q,
          results: query.q === '' ? [] : searchResults(query.q, pace, now),
        },
      },
    };
  return {
    ...common,
    summary: 'No case attached',
    body: {
      kind: 'choose',
      options: listCases().map((c) => ({
        value: c.id,
        label: `${c.title} (v${latestVersion(c).version})`,
      })),
    },
  };
}
