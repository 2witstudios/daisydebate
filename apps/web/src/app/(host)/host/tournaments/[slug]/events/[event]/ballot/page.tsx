import { createId } from '@paralleldrive/cuid2';
import { eventBallotAuthoringViewSchema } from '@daisy/protocol/lobby/ballot-read';
import { eventBallotPath } from '../../../../../../../../features/tab/event-ballot-route';
import { requireTabRelease } from '../../../../../../../../features/tab/release';
import {
  AUTUMN,
  WINTER,
} from '../../../../../../../../features/tab/sample/moment';
import { readOwnRoute } from '../../../../../../../(shell)/friends/read-route';
import { GET as ballotGET } from '../../../../../../../api/tab/event-ballot/route';
import { HostShell } from '../../../../../../../../ui/tab/host-shell/host-shell';
import { BackButton } from '../../../../../../../../ui/tab/action-control/action-control';
import { BallotAuthoringEditor } from '../../../../../../../../ui/tab/ballot-settings/ballot-authoring-editor';
import { readStoredSetup } from '../../../setup/stored-setup';
import { ballotAuthoringAction } from './actions';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readBallotSettings } from '../../../../../../../../features/tab/ballot-definition';
import { BallotSettings } from '../../../../../../../../ui/tab/ballot-settings/ballot-settings';
import { sampleSubmit } from '../../../../../../../(tab)/sample-submit';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../../../features/tab/tournament';
import { requireGrant } from '../../../../../require-grant';

export const metadata: Metadata = { title: 'Ballot' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string; event: string }>;
  readonly searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const { slug, event } = await params;
  if (slug !== AUTUMN && slug !== WINTER) {
    await requireTabRelease();
    const stored = await readStoredSetup(slug, event);
    if (!stored || stored.kind !== 'configured') notFound();
    const view = await readOwnRoute(
      ballotGET,
      eventBallotPath(stored.view.lobbyId, stored.event.eventId),
      eventBallotAuthoringViewSchema,
    );
    if (!view) notFound();
    const context = {
      lobbyId: view.lobbyId,
      eventId: view.eventId,
      lobbyVersion: view.versions.lobby,
      settingsVersion: view.versions.settings,
      eventName: view.name,
      eventLabel: view.label,
      handle: stored.view.handle,
    };
    const { saved } = await searchParams;
    return (
      <HostShell rail={stored.rail} current="setup">
        <BackButton
          href={`${hostRoutes.setup(stored.view.handle)}?event=${view.eventId}`}
          label="Setup"
        />
        <BallotAuthoringEditor
          key={`${view.versions.lobby}:${view.versions.settings}`}
          view={view}
          saved={typeof saved === 'string' ? saved : null}
          publish={ballotAuthoringAction.bind(
            null,
            { ...context, commandId: createId() },
            'publish',
          )}
          pin={ballotAuthoringAction.bind(
            null,
            { ...context, commandId: createId() },
            'pin',
          )}
          screening={ballotAuthoringAction.bind(
            null,
            { ...context, commandId: createId() },
            'screening',
          )}
        />
      </HostShell>
    );
  }
  const scene = await requireGrant(hostRoutes.ballot(slug, event));
  const rail = readTimelineRail(slug, scene);
  const settings = readBallotSettings(slug, event, scene);
  if (rail === null || settings === null) notFound();
  return (
    <BallotSettings
      rail={rail}
      settings={settings}
      submit={sampleSubmit(hostRoutes.ballot(slug, event))}
    />
  );
}
