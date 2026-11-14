import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readSchoolEntries } from '../../../../../features/tab/entries';
import { tabRoutes } from '../../../../../features/tab/routes';
import { requestSampleScene } from '../../../../../features/tab/sample/request-scene';
import { SchoolEntries } from '../../../../../ui/tab/school-entries/school-entries';
import { sampleSubmit } from '../../../sample-submit';

export const metadata: Metadata = { title: 'Entries' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entries = readSchoolEntries(slug, await requestSampleScene());
  if (entries === null) notFound();
  return (
    <SchoolEntries
      entries={entries}
      submit={sampleSubmit(tabRoutes.entries(slug))}
    />
  );
}
