import type { LobbyRow, LobbySection } from '../../../features/lobby/rows';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { StatusLine } from '../../components/status-line/status-line';
import type { StatusTone } from '../../components/status-line/status-line-class';
import { MediaPageLink } from '../../round-media/media-page-link';

const tones: Readonly<Record<LobbyRow['state'], StatusTone>> = {
  open: 'online',
  starting: 'neutral',
  live: 'live',
};

/** A row's actions: Watch beside its seat action, side by side, stacked on a phone. */
function RowActions({ row }: { readonly row: LobbyRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-2 justify-self-end max-narrow:flex-col max-narrow:items-stretch">
      {row.actions.map((action) => (
        // One name that starts with the visible verb (WCAG label in name).
        <MediaPageLink
          key={action.verb}
          href={action.href}
          aria-label={`${action.verb}: ${row.title}`}
          className={`${buttonClass(action.primary ? 'primary' : 'secondary')} whitespace-nowrap`}
        >
          {action.verb}
        </MediaPageLink>
      ))}
    </div>
  );
}

/** Name, host and Room facts on the left; status, then the actions, on the right. */
function Row({ row }: { readonly row: LobbyRow }) {
  return (
    <li className="grid grid-cols-lobby-row items-center gap-4 border-t border-border px-4 py-3 max-narrow:grid-cols-lobby-row-compact max-narrow:gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-strong">{row.title}</span>
          {row.mode === 'Ranked' ? <Badge tone="clay">Ranked</Badge> : null}
        </p>
        <p className="truncate text-sm text-ink-muted">
          <span className="hidden max-narrow:inline">{`${row.status} · `}</span>
          {row.host === null ? null : (
            <span className="text-ink">{`${row.host} · `}</span>
          )}
          {[row.format, ...row.facts, row.topic].join(' · ')}
        </p>
      </div>
      <span className="max-narrow:hidden">
        <StatusLine tone={tones[row.state]}>{row.status}</StatusLine>
      </span>
      {row.actions.length === 0 ? <span /> : <RowActions row={row} />}
    </li>
  );
}

/** The page's Rooms in one flat list, split by where each Room stands. */
export function RoomList({
  sections,
}: {
  readonly sections: readonly LobbySection[];
}) {
  return (
    <section
      aria-label="Available rooms"
      className="overflow-hidden rounded-lg border border-border bg-surface-raised"
    >
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`lobby-${section.id}`}>
          <h2
            id={`lobby-${section.id}`}
            className="bg-surface px-4 py-2 text-xs font-heavy tracking-wider text-ink-muted uppercase"
          >
            {section.label}
          </h2>
          <ul>
            {section.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
