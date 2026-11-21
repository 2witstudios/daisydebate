import type { ReactNode } from 'react';
import type { HostLeague as Read } from '../../../features/tab/league';
import { holdLabel } from '../../../features/tab/settings';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { ListCard, ListHeading, ListRow } from '../list-card/list-card';
import { SeasonStandings } from '../season-standings/season-standings';
import { SettingRow } from '../setting-row/setting-row';

/**
 * A league as its owner runs it: what asks to count for the season, the
 * template events follow, the season and ladder, and the lobby's settings.
 */
export function HostLeague({
  rail,
  league,
  requestControls,
  standingLobbies,
}: {
  readonly rail: TimelineRail;
  readonly league: Read;
  readonly standingLobbies?: ReactNode;
  readonly requestControls?: (request: Read['requests'][number]) => ReactNode;
}) {
  return (
    <HostShell rail={rail} current="league">
      <PageHeader
        title={league.name}
        lede={league.lede}
        actions={
          league.lobbyView ? (
            <ActionButton size="small" action={league.lobbyView} />
          ) : null
        }
      />
      {standingLobbies}
      {league.requests.length === 0 ? null : (
        <ListCard>
          <ListHeading>Asking to count for the season</ListHeading>
          <ul>
            {league.requests.map((request) => (
              <ListRow
                key={request.id ?? request.event}
                title={request.event}
                facts={request.facts}
                detail={request.meets}
                trailing={
                  requestControls ? (
                    requestControls(request)
                  ) : (
                    <>
                      <ActionButton
                        action={request.decline}
                        about={request.event}
                      />
                      <ActionButton
                        action={request.sanction}
                        about={request.event}
                      />
                    </>
                  )
                }
              />
            ))}
          </ul>
        </ListCard>
      )}
      <div className="grid grid-cols-2 items-start gap-5 max-rail:grid-cols-1">
        {league.template ? (
          <ListCard>
            <ListHeading>{league.template.name}</ListHeading>
            <ul>
              {league.template.settings.map((setting) => (
                <ListRow
                  key={setting.label}
                  title={setting.label}
                  detail={setting.value}
                  trailing={
                    <span className="text-sm text-ink-muted">
                      {holdLabel(setting)}
                    </span>
                  }
                />
              ))}
              <li className="flex items-center gap-3 px-4 py-3 text-sm text-ink-muted">
                {league.template.edit ? (
                  <ActionButton size="small" action={league.template.edit} />
                ) : null}
                <span>{league.template.note}</span>
              </li>
            </ul>
          </ListCard>
        ) : null}
        <ListCard>
          <ListHeading>{league.season.heading}</ListHeading>
          <SeasonStandings rows={league.season.rows} />
          <div className="flex flex-col items-start gap-2 border-t border-border px-4 py-3 text-sm text-ink-muted">
            <p>{league.season.note}</p>
            {league.season.rule ? (
              <ActionButton size="small" action={league.season.rule} />
            ) : null}
          </div>
          <ListHeading>League ladder</ListHeading>
          <div className="flex flex-col items-start gap-2 px-4 py-3 text-sm">
            <p>{league.ladder.detail}</p>
            {league.ladder.open ? (
              <ActionButton size="small" action={league.ladder.open} />
            ) : null}
          </div>
        </ListCard>
      </div>
      {league.lobby.length ? (
        <ListCard>
          <ListHeading>The lobby</ListHeading>
          <ul>
            {league.lobby.map((setting) => (
              <SettingRow key={setting.label} setting={setting} />
            ))}
          </ul>
        </ListCard>
      ) : null}
    </HostShell>
  );
}
