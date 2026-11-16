import { systemId } from '@daisy/clock';
import { hostResultsViewSchema } from '@daisy/protocol/lobby/results-read';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { AUTUMN, WINTER } from '../../../../../../features/tab/sample/moment';
import { hostResultsPath } from '../../../../../../features/tab/host-results-route';
import {
  eventResultsOf,
  bracketOf,
} from '../../../../../../features/tab/results';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { linkTo } from '../../../../../../features/tab/action';
import { CompletionCommandForm } from '../../../../../../ui/tab/completion/completion-command-form';
import { eventCompletionAction } from '../completion-actions';
import { readStoredHostNavigation } from '../../../read-navigation';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { GET } from '../../../../../api/tab/host-results/route';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readEventResults } from '../../../../../../features/tab/results';
import { readSetup } from '../../../../../../features/tab/setup';
import { Results } from '../../../../../../ui/tab/results/results';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Results' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;
  if (slug !== AUTUMN && slug !== WINTER) {
    await requireTabRelease();
    const navigation = await readStoredHostNavigation('lobby', slug);
    if (!navigation) notFound();
    const { event } = await searchParams;
    const selected =
      typeof event === 'string'
        ? navigation.events.find((one) => one.eventId === event)
        : navigation.events[0];
    if (!selected) notFound();
    const read = await readOwnRoute(
      GET,
      hostResultsPath(navigation.id, selected.eventId),
      hostResultsViewSchema,
    );
    if (!read) notFound();
    const wallClock = (at: string) =>
      new Intl.DateTimeFormat('en', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(at)) + ' UTC';
    const projected = eventResultsOf(read.results, {
      wallClock,
      bracket: {
        stages: read.stages.flatMap(
          (stage) => bracketOf(stage, wallClock).stages,
        ),
      },
    });
    const bound = {
      lobbyId: navigation.id,
      eventId: selected.eventId,
      handle: slug,
    };
    const openings = new Map(
      read.results.audiences
        .filter((row) =>
          row.openings.some((opening) => opening.state.kind === 'openable'),
        )
        .map(
          (row) =>
            [
              `${row.tabRoundId}:${row.audience}`,
              read.results.capabilities.release ? (
                <div
                  key={`${row.tabRoundId}:${row.audience}`}
                  className="flex flex-col gap-3"
                >
                  {row.openings
                    .filter((opening) => opening.state.kind === 'openable')
                    .map((opening) => (
                      <CompletionCommandForm
                        key={opening.part}
                        label={`Open ${opening.part} for ${row.tabRoundName} to ${row.audience.replaceAll('_', ' ')}`}
                        submitLabel={`Open ${opening.part}`}
                        action={eventCompletionAction.bind(null, {
                          ...bound,
                          commandId: systemId.next(),
                          target: {
                            type: 'open-audience',
                            tabRoundId: row.tabRoundId,
                            thing: opening.part,
                            audience: row.audience,
                          },
                        })}
                      >
                        {null}
                      </CompletionCommandForm>
                    ))}
                </div>
              ) : null,
            ] as const,
        )
        .filter(([, control]) => control !== null),
    );
    return (
      <Results
        rail={hostNavigationRail(navigation)}
        event={{
          current: selected.name,
          position: `${navigation.events.indexOf(selected) + 1} of ${navigation.events.length}`,
          others: navigation.events
            .filter((one) => one.eventId !== selected.eventId)
            .map((one) =>
              linkTo(
                one.name,
                `${hostRoutes.results(slug)}?event=${one.eventId}`,
              ),
            ),
        }}
        results={projected}
        storedActions={{
          openings,
          certify:
            read.results.certification.kind === 'ready' &&
            read.results.capabilities.certify ? (
              <CompletionCommandForm
                label="Certify these current published results"
                submitLabel="Certify current results"
                action={eventCompletionAction.bind(null, {
                  ...bound,
                  commandId: systemId.next(),
                  target: {
                    type: 'certify-event',
                    resultsVersion: read.results.resultsVersion,
                  },
                })}
              >
                {null}
              </CompletionCommandForm>
            ) : null,
        }}
      />
    );
  }

  const scene = await requireGrant(hostRoutes.results(slug));
  const rail = readTimelineRail(slug, scene);
  const results = readEventResults(slug, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || results === null || setup === null) notFound();
  return <Results rail={rail} event={setup.event} results={results} />;
}
