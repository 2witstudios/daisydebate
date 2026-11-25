import { eventBallotAuthoringViewSchema } from '@daisy/protocol/lobby/ballot-read';
import { createId } from '@paralleldrive/cuid2';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readOwnRoute } from '../../../../../../../../server/render-read';
import { eventBallotPath } from '../../../../../../../../features/tab/event-ballot-route';
import { requireTabRelease } from '../../../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { BackButton } from '../../../../../../../../ui/tab/action-control/action-control';
import { BallotAuthoringEditor } from '../../../../../../../../ui/tab/ballot-settings/ballot-authoring-editor';
import { HostShell } from '../../../../../../../../ui/tab/host-shell/host-shell';
import { GET as ballotGET } from '../../../../../../../api/tab/event-ballot/route';
import { readStoredSetup } from '../../../setup/stored-setup';
import { ballotAuthoringAction } from './actions';

export const metadata: Metadata = { title: 'Ballot' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string; event: string }>;
  readonly searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const { slug, event } = await params;
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
