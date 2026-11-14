import type {
  LeagueLobby as Read,
  LeaguePanel,
} from '../../../features/tab/league';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { TabLinks } from '../../components/tab-links/tab-links';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { TournamentGroups } from '../tournament-groups/tournament-groups';
import { LeagueLadder } from './league-ladder';
import { LeagueSeason } from './league-season';

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
      return <LeagueLadder ladder={panel} />;
    case 'season':
      return <LeagueSeason season={panel} />;
    case 'tournaments':
      return (
        <>
          <TournamentGroups label="Tournaments" groups={panel.groups} />
          <p className="text-sm text-ink-muted">{panel.note}</p>
        </>
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
        actions={
          lobby.create === null ? null : <ActionButton action={lobby.create} />
        }
      />
      <TabLinks label="League" tabs={lobby.tabs} />
      <Panel panel={lobby.panel} />
    </ReadingPage>
  );
}
