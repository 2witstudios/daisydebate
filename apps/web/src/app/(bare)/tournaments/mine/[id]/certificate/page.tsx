import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { getResults } from '../../../../../../features/tournaments/get-results';
import { requireAccess } from '../../../../../../lib/access';
import { CertificatePage } from '../../../../../../ui/tournaments/certificate/certificate-page';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Certificate' };

/** Guarded and outside the shell: a clean page to read or print. */
export default async function CertificateRoute({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  await requireAccess(`/tournaments/mine/${id}/certificate`, searchParams);
  const read = getResults(id, true);
  if (read.kind !== 'results' || !read.data.mine) notFound();
  return (
    <CertificatePage tournament={read.data.tournament} mine={read.data.mine} />
  );
}
