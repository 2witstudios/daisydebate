import { createId } from '@paralleldrive/cuid2';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { linkTo } from '../../../../../../features/tab/action';
import { resolvedEntry } from '../../../../../../features/tab/reads/resolved-settings';
import {
  hostTiersReleased,
  requireTabRelease,
} from '../../../../../../features/tab/release';
import { hostingAccountViewSchema } from '@daisy/protocol/lobby/hosting-read';
import { hostingAccountPath } from '../../../../../../features/hosting-purchases/routes';
import { HostedFeatures } from '../../../../../../ui/hosting/hosting-panels';
import { GET as hostingGET } from '../../../../../api/tab/hosting/route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { SetupPairingForm } from '../../../../../../ui/tab/setup/pairing-form';
import { Setup } from '../../../../../../ui/tab/setup/setup';
import { setupPairingAction } from './actions';
import { readStoredSetup } from './stored-setup';

export const metadata: Metadata = { title: 'Setup' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{
    panel?: string | string[];
    event?: string | string[];
  }>;
}) {
  const { slug } = await params;
  const { panel, event } = await searchParams;
  await requireTabRelease();
  const stored = await readStoredSetup(
    slug,
    typeof event === 'string' ? event : null,
  );
  if (!stored) notFound();
  if (stored.kind === 'empty')
    return (
      <Setup
        rail={stored.rail}
        empty={{
          addEvent: stored.view.capabilities.manage
            ? linkTo('Add an event', hostRoutes.events(slug))
            : null,
        }}
      />
    );
  const canPair =
    stored.view.capabilities.manage &&
    resolvedEntry(stored.settings, 'pairing.preset')?.locked === null;
  const hosting = (await hostTiersReleased())
    ? await readOwnRoute(
        hostingGET,
        hostingAccountPath(slug),
        hostingAccountViewSchema,
      )
    : null;
  const on = (key: 'recording.capture' | 'judging.ai_judge' | 'broadcast.live') =>
    (resolvedEntry(stored.settings, key)?.value as { value?: string } | undefined)
      ?.value === 'on';
  return (
    <Setup
      rail={stored.rail}
      setup={
        hosting?.tier === 'free'
          ? {
              ...stored.setup,
              // Free hosting never records: Video and judging says so.
              settings: stored.setup.settings.filter(
                (setting) => !setting.keys.includes('recording.capture'),
              ),
            }
          : stored.setup
      }
      hosted={
        hosting ? (
          <HostedFeatures
            account={hosting}
            states={{
              recording: on('recording.capture'),
              ai_judging: on('judging.ai_judge'),
              broadcast: on('broadcast.live'),
            }}
            upgradeHref={hostRoutes.upgrade(slug)}
          />
        ) : null
      }
      panel={panel === 'pairing' && canPair ? 'pairing' : null}
      pairingForm={
        <SetupPairingForm
          pairing={stored.setup.pairing}
          action={setupPairingAction.bind(null, {
            eventId: stored.event.eventId,
            settingsVersion: stored.settings.settingsVersion,
            commandId: createId(),
            handle: stored.view.handle,
          })}
        />
      }
    />
  );
}
