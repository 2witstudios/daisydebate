import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { findDestination } from '../../../../features/coming-soon/destinations';
import { resolveExplainer } from '../../../../features/coming-soon/resolve';
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
  const resolution = resolveExplainer((await params).destination);
  if (resolution.kind === 'not-found') notFound();
  if (resolution.kind === 'redirect') redirect(resolution.to);
  const { destination } = resolution;
  const identity = await requestIdentity();
  return (
    <Explainer
      destination={destination}
      notify={notifyAction(destination.slug, identity.state === 'member')}
      preview={previewFor(destination.slug)}
    />
  );
}
