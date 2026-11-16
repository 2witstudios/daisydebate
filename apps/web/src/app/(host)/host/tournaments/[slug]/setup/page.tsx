import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readSetup } from '../../../../../../features/tab/setup';
import { Setup } from '../../../../../../ui/tab/setup/setup';
import { sampleSubmit } from '../../../../../(tab)/sample-submit';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';
import { createId } from '@paralleldrive/cuid2';
import { AUTUMN, WINTER } from '../../../../../../features/tab/sample/moment';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { linkTo } from '../../../../../../features/tab/action';
import { resolvedEntry } from '../../../../../../features/tab/reads/resolved-settings';
import { SetupPairingForm } from '../../../../../../ui/tab/setup/pairing-form';
import { readStoredSetup } from './stored-setup';
import { setupPairingAction } from './actions';

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
  if (slug !== AUTUMN && slug !== WINTER) {
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
  const scene = await requireGrant(hostRoutes.setup(slug));
  const rail = readTimelineRail(slug, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || setup === null) notFound();
  return (
    <Setup
      rail={rail}
      setup={setup}
      panel={panel === 'pairing' ? 'pairing' : null}
      submit={sampleSubmit(hostRoutes.setup(slug))}
    />
  );
}
