import Link from 'next/link';
import type {
  PanelCard,
  PinnedPanel,
  RoomPanelView,
} from '../../../features/prep/room-panel';
import { roomPanelHref } from '../../../features/prep/room-panel-query';
import { inertActions } from '../../../features/prep/actions';
import { currentVersion } from '../../../features/prep/cards/card';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { controlClass } from '../form-controls/form-class';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { SourceText } from '../source-text/source-text';

const link = 'no-underline hover:no-underline';

function CardList({
  cards,
  empty,
}: {
  readonly cards: readonly PanelCard[];
  readonly empty: string;
}) {
  if (cards.length === 0)
    return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ul>
      {cards.map((card) => (
        <li key={card.id}>
          <Link
            href={card.href}
            className={`flex min-h-16 items-center gap-3 text-ink ${link}`}
          >
            <span className="inline-flex size-avatar-md shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold">
              <PrepIcon name="card" size={16} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-strong">{card.title}</span>
              <span className="text-xs text-ink-muted">{card.meta}</span>
            </span>
            <Icon name="chevronRight" size={16} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Read-only search results; each opens the card in the panel. */
export function SearchResults(props: {
  readonly search: {
    readonly q: string;
    readonly results: readonly PanelCard[];
  };
  readonly query: RoomPanelView['query'];
  readonly pin?: string;
}) {
  if (props.search.q === '') return null;
  return (
    <CardList
      cards={props.search.results.map((c) => ({
        ...c,
        href: roomPanelHref({
          ...props.query,
          ...(props.pin === undefined ? {} : { pin: props.pin }),
          card: c.id,
        }),
      }))}
      empty="Nothing in your library matches that."
    />
  );
}

export function SearchBox({
  q,
  query,
}: {
  readonly q: string;
  readonly query: RoomPanelView['query'];
}) {
  return (
    <form
      action="/prep/in-debate"
      method="get"
      role="search"
      className="flex flex-col gap-2"
    >
      {query.pin === '' ? null : (
        <input type="hidden" name="pin" value={query.pin} />
      )}
      {query.version === 0 ? null : (
        <input type="hidden" name="v" value={query.version} />
      )}
      <input type="hidden" name="tab" value="search" />
      {query.open ? <input type="hidden" name="open" value="1" /> : null}
      <label
        className={`${controlClass} flex items-center gap-2 text-ink-muted`}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search your library"
          aria-label="Search your library"
          className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
        />
      </label>
    </form>
  );
}

function ReadingCard({
  pinned,
  query,
}: {
  readonly pinned: PinnedPanel;
  readonly query: RoomPanelView['query'];
}) {
  const body = pinned.body;
  if (body.kind !== 'card') return null;
  const { card } = body;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link
          href={body.backHref}
          className="inline-flex items-center gap-1 text-sm font-strong"
        >
          <PrepIcon name="arrowLeft" size={16} />
          Cards
        </Link>
        <Badge tone="neutral">Read only</Badge>
      </div>
      <h3 className="font-display text-lg leading-tight font-bold">
        {card.tagLine}
      </h3>
      <p className="text-xs font-strong text-ink-muted">
        {`${card.author} ${card.year} · ${card.publication} · reads in about ${body.clock}`}
      </p>
      <p className="text-base leading-normal text-ink-muted">
        <SourceText
          segments={[
            { kind: 'context', text: '… ' },
            ...currentVersion(card).segments.filter((s) => s.kind === 'read'),
            { kind: 'context', text: ' …' },
          ]}
        />
      </p>
      <div className="flex gap-2">
        <InertActionButton action={inertActions.copyCiteInRoom} symbol="copy" />
        <Link
          href={query.send ? body.cancelHref : body.sendHref}
          className={`${buttonClass('secondary')} ${link}`}
        >
          <PrepIcon name="send" size={18} />
          Send to room
        </Link>
      </div>
      {body.sendAsk ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-md border border-gold-border bg-gold-soft p-3 text-sm"
        >
          <p>
            <strong className="block text-base">
              Send this card to the room?
            </strong>
            Your opponent and the judge will see this card and its citation.
          </p>
          <div className="flex gap-2">
            <InertActionButton
              action={inertActions.sendCard}
              variant="primary"
            />
            <Link
              href={body.cancelHref}
              className={`${buttonClass('secondary')} ${link}`}
            >
              Cancel
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PinnedBody({
  pinned,
  query,
}: {
  readonly pinned: PinnedPanel;
  readonly query: RoomPanelView['query'];
}) {
  const body = pinned.body;
  if (body.kind === 'card')
    return <ReadingCard pinned={pinned} query={query} />;
  return (
    <div className="flex flex-col gap-3">
      <PrepTabs
        label="Prep panel"
        current={body.tab}
        tabs={body.tabs.map((t) => ({
          id: t.id,
          label: t.label,
          href: t.href,
        }))}
      />
      {body.tab === 'speech' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <strong>{`Now: ${body.speech.label}`}</strong>
          </p>
          <ul className="flex flex-col gap-2">
            {body.speech.rows.map((row) => (
              <li key={row.id}>
                <label
                  className={`flex min-h-12 items-center gap-3 rounded-md border px-3 text-base ${
                    row.current
                      ? 'border-accent bg-accent-soft font-strong'
                      : 'border-border'
                  }`}
                >
                  <input
                    type="checkbox"
                    name={row.id}
                    className="size-5 accent-accent"
                  />
                  <span className="flex-1">{row.label}</span>
                  <span className="text-sm text-ink-muted tabular-nums">
                    {row.clock}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {body.speech.claim === null ? null : (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-3">
              <p className="text-xs font-bold text-ink-faint">Claim</p>
              <p className="text-base">{body.speech.claim}</p>
              {body.speech.nextCard === null ? null : (
                <p className="text-xs font-strong text-ink-muted">{`Card next: ${body.speech.nextCard}`}</p>
              )}
            </div>
          )}
        </div>
      ) : null}
      {body.tab === 'cards' ? (
        <CardList
          cards={body.cards.map((c) => ({
            ...c,
            href: roomPanelHref({ ...query, card: c.id }),
          }))}
          empty="No cards in this case yet"
        />
      ) : null}
      {body.tab === 'search' ? (
        <div className="flex flex-col gap-3">
          <SearchBox q={body.search.q} query={query} />
          <SearchResults search={body.search} query={query} />
        </div>
      ) : null}
    </div>
  );
}
