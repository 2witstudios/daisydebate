import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
import { tournamentEventSettingsPath } from '../../../../../../../../features/tab/tournament-event-settings-route';
import { readOwnRoute } from '../../../../../../../(shell)/friends/read-route';
import { GET } from '../../../../../../../api/tab/tournament-event-settings/route';
import { releaseRoundContent } from './actions';
import { systemId } from '@daisy/clock';
import { notFound } from 'next/navigation';
import { hostNavigationRail } from '../../../../../../../../features/tab/host-navigation';
import { hostResolutions } from '../../../../../../../../features/tab/host-resolutions';
import { requireTabRelease } from '../../../../../../../../features/tab/release';
import { PageHeader } from '../../../../../../../../ui/components/page-header/page-header';
import { TabLinks } from '../../../../../../../../ui/components/tab-links/tab-links';
import { BackButton } from '../../../../../../../../ui/tab/action-control/action-control';
import { CommandControl } from '../../../../../../../../ui/tab/action-control/command-control';
import {
  ResolutionFields,
  RoundFields,
} from '../../../../../../../../ui/tab/events-schedule/event-command-fields';
import { HostShell } from '../../../../../../../../ui/tab/host-shell/host-shell';
import {
  ListCard,
  ListHeading,
  ListRow,
} from '../../../../../../../../ui/tab/list-card/list-card';
import { readStoredHostNavigation } from '../../../../../read-navigation';
import { eventAction } from '../../actions';
import { readStoredHostEvents } from '../../read-events';

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string; event: string }>;
}) {
  await requireTabRelease();
  const { slug, event } = await params;
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  const stored = await readStoredHostEvents(navigation.id);
  if (!stored) notFound();
  const settings = await readOwnRoute(
    GET,
    tournamentEventSettingsPath(navigation.id, event),
    tournamentEventSettingsViewSchema,
  );
  const resolved = settingValueSchemas['resolution.rule'].safeParse(
    settings?.settings.find((entry) => entry.key === 'resolution.rule')?.value,
  );
  const posting = settingValueSchemas['audience.posting'].safeParse(
    settings?.settings.find((entry) => entry.key === 'audience.posting')?.value,
  );
  const view = hostResolutions(
    stored,
    event,
    systemId.next,
    resolved.success ? resolved.data : null,
    posting.success ? posting.data : undefined,
  );
  if (!view) notFound();
  return (
    <HostShell
      rail={hostNavigationRail(navigation)}
      current="setup"
      asideLabel="How each round gets its resolution"
      aside={
        <>
          <h2 className="font-display text-xl font-bold">By round</h2>
          {view.releaseRule ? (
            <p className="text-sm text-ink-muted">{view.releaseRule}</p>
          ) : null}
          {view.rounds.map((round) => (
            <details key={round.id}>
              <summary className="cursor-pointer font-strong">
                {round.title}
                {round.released ? ' · Released' : ''}
              </summary>
              {round.released || !round.save ? null : (
                <CommandControl
                  action={round.save}
                  bind={(command) => eventAction.bind(null, command)}
                >
                  <RoundFields
                    name={round.name}
                    selected={round.selected}
                    choices={round.save.command.target.resolutionChoices}
                  />
                </CommandControl>
              )}
              {[round.release, round.openPosting].flatMap((action) =>
                action
                  ? [
                      <CommandControl
                        key={action.label}
                        action={action}
                        bind={(command) =>
                          releaseRoundContent.bind(null, command)
                        }
                      >
                        {null}
                      </CommandControl>,
                    ]
                  : [],
              )}
            </details>
          ))}
          {view.rounds.length === 0 ? <p>No rounds configured.</p> : null}
        </>
      }
    >
      <BackButton href={view.back.href} label={view.back.label} />
      <TabLinks label="Events" tabs={view.tabs} />
      <PageHeader title="Resolutions" lede={view.title} />
      <ListCard>
        <ListHeading>Pool</ListHeading>
        <ul>
          {view.resolutions.map((word) => (
            <ListRow key={word.id} title={word.title} detail={word.pool} />
          ))}
        </ul>
        <details className="p-4">
          <summary className="cursor-pointer font-strong">
            Add resolution
          </summary>
          <CommandControl
            action={view.add}
            bind={(command) => eventAction.bind(null, command)}
          >
            <ResolutionFields
              pools={view.add.command.target.pools.map(({ poolId, name }) => ({
                resolutionPoolId: poolId,
                name,
              }))}
            />
          </CommandControl>
        </details>
      </ListCard>
    </HostShell>
  );
}
