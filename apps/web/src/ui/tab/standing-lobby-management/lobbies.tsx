import type { StandingLobbyManagement } from '../../../features/tab/reads/standing-lobby-management';
import { hostRoutes } from '../../../features/tab/routes';
import { linkTo } from '../../../features/tab/action';
import { ActionButton } from '../action-control/action-control';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { ageRuleLabel } from './labels';

export function StandingLobbies({
  slug,
  read,
}: {
  readonly slug: string;
  readonly read: StandingLobbyManagement;
}) {
  return (
    <ListCard>
      <ListHeading>Standing lobbies</ListHeading>
      <ul>
        {read.lobbies.length === 0 ? (
          <ListRow title="No standing lobbies yet" />
        ) : null}
        {read.lobbies.map((lobby) => {
          const active = lobby.seasons.find(
            (season) => season.status === 'active',
          );
          return (
            <ListRow
              key={lobby.id}
              title={lobby.name}
              detail={[
                ageRuleLabel[lobby.ageRule],
                ...lobby.ladders.map(({ name }) => name),
                active ? `${active.name} active` : 'No active season',
              ].join(' · ')}
              trailing={
                <ActionButton
                  size="small"
                  action={linkTo(
                    `Manage ${lobby.name}`,
                    hostRoutes.standingLobbies(slug, { lobby: lobby.id }),
                  )}
                />
              }
            />
          );
        })}
      </ul>
      {read.canManage ? (
        <div className="border-t border-border p-4">
          <ActionButton
            size="small"
            action={linkTo(
              'New lobby',
              hostRoutes.standingLobbies(slug, { panel: 'new-lobby' }),
              true,
            )}
          />
        </div>
      ) : null}
    </ListCard>
  );
}
