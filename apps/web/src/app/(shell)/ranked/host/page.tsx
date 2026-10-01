import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { driveHost } from '../../../../features/ranked/drive-host';
import { parseHostQuery } from '../../../../features/ranked/host-query';
import { requireAccess } from '../../../../lib/access';
import { Host } from '../../../../ui/ranked/host';

export const metadata: Metadata = { title: 'Host a ranked table' };

export default async function HostRankedTablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ranked/host', searchParams);
  return <Host screen={driveHost(parseHostQuery(await searchParams))} />;
}
