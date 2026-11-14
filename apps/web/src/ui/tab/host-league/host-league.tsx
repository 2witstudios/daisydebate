import type { HostLeague as Read } from '../../../features/tab/league';
import type { TimelineRail } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton, ActionLink } from '../action-control/action-control';
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
}: {
  readonly rail: TimelineRail;
  readonly league: Read;
}) {
  return (
    <HostShell rail={rail} current="league">
      <PageHeader
        title={league.name}
        lede={league.lede}
        actions={<ActionLink action={league.lobbyView} />}
      />
      {league.requests.length === 0 ? null : (
        <ListCard>
          <ListHeading>Asking to count for the season</ListHeading>
          <ul>
            {league.requests.map((request) => (
              <ListRow
                key={request.event}
                title={request.event}
                facts={request.facts}
                detail={request.meets}
                trailing={
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
                }
              />
            ))}
          </ul>
        </ListCard>
      )}
      <div className="grid grid-cols-2 items-start gap-5 max-rail:grid-cols-1">
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
                    {setting.hold === 'enforced' ? 'Enforced' : 'Default'}
                  </span>
                }
              />
            ))}
            <li className="px-4 py-3 text-sm text-ink-muted">
              <ActionLink action={league.template.edit} /> ·{' '}
              {league.template.note}
            </li>
          </ul>
        </ListCard>
        <ListCard>
          <ListHeading>{league.season.heading}</ListHeading>
          <SeasonStandings rows={league.season.rows} />
          <p className="border-t border-border px-4 py-3 text-sm text-ink-muted">
            {league.season.note} <ActionLink action={league.season.rule} />
          </p>
          <ListHeading>League ladder</ListHeading>
          <p className="px-4 py-3 text-sm">
            {league.ladder.detail} <ActionLink action={league.ladder.open} />
          </p>
        </ListCard>
      </div>
      <ListCard>
        <ListHeading>The lobby</ListHeading>
        <ul>
          {league.lobby.map((setting) => (
            <SettingRow key={setting.label} setting={setting} />
          ))}
        </ul>
      </ListCard>
    </HostShell>
  );
}
