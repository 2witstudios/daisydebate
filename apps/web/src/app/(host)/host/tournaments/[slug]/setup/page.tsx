import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { linkTo } from '../../../../../../features/tab/action';
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
    true,
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
  return (
    <Setup
      rail={stored.rail}
      setup={stored.setup}
      panel={panel === 'pairing' ? 'pairing' : null}
      renderPairing={(pairing, action) => (
        <SetupPairingForm
          pairing={pairing}
          action={setupPairingAction.bind(null, action.command)}
        />
      )}
    />
  );
}
