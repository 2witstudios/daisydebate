import type { Metadata } from 'next';
import { Suspense } from 'react';
import { tabRoutes } from '../../../../../../features/tab/routes';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { requireAccess } from '../../../../../../lib/access';
import { readLiveSection } from '../../../../../../features/tab/room';
import { requestSampleScene } from '../../../../../../features/tab/sample/request-scene';
import { SampleActionNotice } from '../../../../../../ui/components/sample-action/sample-action-notice';
import { LiveSection } from '../../../../../../ui/tab/live-section/live-section';

export const metadata: Metadata = { title: 'Speech section' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ room: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { room: roomId } = await params;
  // A Room needs an account, sample or not: the page rechecks it for itself.
  await requireAccess(tabRoutes.liveRoom(roomId), searchParams);
  const section = readLiveSection(roomId, await requestSampleScene());
  if (section === null) notFound();
  return (
    <>
      <Suspense fallback={null}>
        <SampleActionNotice />
      </Suspense>
      <LiveSection section={section} />
    </>
  );
}
