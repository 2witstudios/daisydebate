import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { SearchParams } from '../../../../../../../../features/access/decision';
import { tabRoutes } from '../../../../../../../../features/tab/routes';
import { readLiveSection } from '../../../../../../../../features/tab/sample/read-room';
import { requestSampleScene } from '../../../../../../../../features/tab/sample/request-scene';
import { requireAccess } from '../../../../../../../../lib/access';
import { SampleActionNotice } from '../../../../../../../../ui/components/sample-action/sample-action-notice';
import { LiveSection } from '../../../../../../../../ui/tab/live-section/live-section';

export const metadata: Metadata = {
  title: 'Speech section',
  robots: { index: false, follow: false },
};

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
