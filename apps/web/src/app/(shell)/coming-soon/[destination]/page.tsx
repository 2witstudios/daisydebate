import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { findDestination } from '../../../../features/coming-soon/destinations';
import { launched, liveHref } from '../../../../features/coming-soon/launch';
import { notifyAction } from '../../../../features/coming-soon/notify';
import { requestIdentity } from '../../../../lib/request-session';
import { Explainer } from '../../../../ui/coming-soon/explainer/explainer';
import { previewFor } from '../../../../ui/coming-soon/previews/preview-for';

type Params = { readonly params: Promise<{ readonly destination: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const destination = findDestination((await params).destination);
  return destination ? { title: `${destination.title} — coming soon` } : {};
}

/** Public: the explainer for a destination that is not open yet. */
export default async function ComingSoonPage({ params }: Params) {
  const destination = findDestination((await params).destination);
  if (destination === null) notFound();
  if (launched[destination.slug]) redirect(liveHref(destination.slug));
  const identity = await requestIdentity();
  return (
    <Explainer
      destination={destination}
      notify={notifyAction(destination.slug, identity.state === 'member')}
      preview={previewFor(destination.slug)}
    />
  );
}
