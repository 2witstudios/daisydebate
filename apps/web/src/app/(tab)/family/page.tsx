import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readFamily } from '../../../features/tab/guardian';
import { requestSampleScene } from '../../../features/tab/sample/request-scene';
import { Family } from '../../../ui/tab/guardian/family';

export const metadata: Metadata = { title: 'Your family' };

export default async function Page() {
  const family = readFamily(await requestSampleScene());
  if (family === null) notFound();
  return <Family family={family} />;
}
