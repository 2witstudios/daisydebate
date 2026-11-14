import Link from 'next/link';
import type {
  LeagueLobby as Read,
  LeaguePanel,
} from '../../../features/tab/league';
import { tabRoutes } from '../../../features/tab/routes';
import { cn } from '../../cn';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { TabLinks } from '../../components/tab-links/tab-links';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { SeasonStandings } from '../season-standings/season-standings';

function Panel({ panel }: { readonly panel: LeaguePanel }) {
  switch (panel.kind) {
    case 'rooms':
      return (
        <>
          <p className="rounded-lg border border-border bg-surface-raised px-4 py-3">
            <strong className="font-strong">{panel.pool.title}</strong>{' '}
            {panel.pool.detail}
          </p>
          <ListCard label="Available rooms">
            {panel.groups.map((group) => (
              <section key={group.heading}>
                <ListHeading>{group.heading}</ListHeading>
                <ul>
                  {group.rooms.map((room) => (
                    <ListRow
                      key={room.title}
                      title={room.title}
                      detail={room.detail}
                      trailing={
                        <ActionButton action={room.action} about={room.title} />
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </ListCard>
          <p className="text-sm text-ink-muted">{panel.note}</p>
        </>
      );
    case 'ladder':
      return (
        <ListCard label="League ladder">
          <ol>
            {panel.rows.map((row) => (
              <li
                key={row.place}
                className={cn(
                  'flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0',
                  row.you && 'bg-hue-teal-soft',
                )}
              >
                <span className="text-ink-muted tabular-nums">{row.place}</span>
                <span className="min-w-0 flex-1">
                  <strong className="font-strong">{row.name}</strong>
                  <span className="text-ink-muted"> · {row.school}</span>
                </span>
                <span className="tabular-nums">{row.rating}</span>
              </li>
            ))}
          </ol>
        </ListCard>
      );
    case 'season':
      return (
        <ListCard>
          <ListHeading>{panel.heading}</ListHeading>
          <SeasonStandings rows={panel.rows} />
          <p className="border-t border-border px-4 py-3 text-sm text-ink-muted">
            {panel.note}
          </p>
        </ListCard>
      );
    case 'tournaments':
      return (
        <ListCard label="Tournaments">
          <ul>
            {panel.tournaments.map((tournament) => (
              <ListRow
                key={tournament.slug}
                title={
                  <Link
                    href={tabRoutes.tournament(tournament.slug)}
                    className="text-ink"
                  >
                    {tournament.name}
                  </Link>
                }
                detail={tournament.detail}
              />
            ))}
          </ul>
        </ListCard>
      );
  }
}

/** A league's standing lobby: its Rooms, ladder, season and tournaments. */
export function LeagueLobby({ lobby }: { readonly lobby: Read }) {
  return (
    <ReadingPage>
      <PageHeader
        title={lobby.name}
        lede={lobby.lede}
        actions={<ActionButton action={lobby.create} />}
      />
      <TabLinks label="League" tabs={lobby.tabs} />
      <Panel panel={lobby.panel} />
    </ReadingPage>
  );
}
