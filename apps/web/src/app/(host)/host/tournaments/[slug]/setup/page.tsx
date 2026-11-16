import { createId } from '@paralleldrive/cuid2';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { linkTo } from '../../../../../../features/tab/action';
import { resolvedEntry } from '../../../../../../features/tab/reads/resolved-settings';
import { requireTabRelease } from '../../../../../../features/tab/release';
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
  return (
    <Setup
      rail={stored.rail}
      setup={stored.setup}
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
