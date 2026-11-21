import type { StandingLobbyManagement } from '../../../features/tab/reads/standing-lobby-management';
import { hostRoutes } from '../../../features/tab/routes';
import { linkTo } from '../../../features/tab/action';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { ageRuleLabel } from './labels';

type Lobby = StandingLobbyManagement['lobbies'][number];
const date = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

export function StandingLobby({
  slug,
  name,
  lobby,
  canManage,
}: {
  readonly slug: string;
  readonly name: string;
  readonly lobby: Lobby;
  readonly canManage: boolean;
}) {
  const link = (
    label: string,
    panel: string,
    item?: string,
    primary = false,
  ) => (
    <ActionButton
      size="small"
      action={linkTo(
        label,
        hostRoutes.standingLobbies(slug, {
          lobby: lobby.id,
          panel,
          ...(item ? { item } : {}),
        }),
        primary,
      )}
    />
  );
  const active = lobby.seasons.some(({ status }) => status === 'active');
  return (
    <>
      <PageHeader
        title={<span className="wrap-anywhere">{lobby.name}</span>}
        lede={`${name} · ${ageRuleLabel[lobby.ageRule]}`}
        actions={canManage ? link('Edit lobby', 'edit-lobby') : null}
      />
      <div className="grid grid-cols-2 items-start gap-5 max-rail:grid-cols-1">
        <ListCard>
          <ListHeading>Ladders</ListHeading>
          <ul>
            {lobby.ladders.length === 0 ? (
              <ListRow
                title="No ladders yet"
                detail="Create a ladder for ranked results."
              />
            ) : null}
            {lobby.ladders.map((ladder) => (
              <ListRow
                key={ladder.id}
                title={ladder.name}
                detail={`Ranked results for ${lobby.name}`}
                trailing={
                  canManage ? link('Edit ladder', 'ladder', ladder.id) : null
                }
              />
            ))}
          </ul>
          {canManage ? (
            <div className="border-t border-border p-4">
              {link('New ladder', 'ladder')}
            </div>
          ) : null}
        </ListCard>
        <ListCard>
          <ListHeading>Seasons</ListHeading>
          <ul>
            {!active ? (
              <ListRow
                title="No active season"
                detail={
                  lobby.ladders.length === 0
                    ? 'This lobby has no active season.'
                    : 'Open a season to start ranked play in this lobby.'
                }
              />
            ) : null}
            {lobby.seasons.map((season) => (
              <ListRow
                key={season.id}
                title={season.name}
                detail={
                  season.status === 'active'
                    ? `Active · Started ${date.format(season.startsAt)}${season.endsAt ? ` · Ends ${date.format(season.endsAt)}` : ''}`
                    : `Closed · Started ${date.format(season.startsAt)}`
                }
                trailing={
                  season.status === 'active' && canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {link('Edit season', 'edit-season', season.id)}
                      {link('Close season', 'close-season', season.id)}
                    </div>
                  ) : null
                }
              />
            ))}
          </ul>
          {canManage && !active && lobby.ladders.length > 0 ? (
            <div className="border-t border-border p-4">
              {link('Open season', 'open-season', undefined, true)}
            </div>
          ) : null}
        </ListCard>
      </div>
    </>
  );
}
