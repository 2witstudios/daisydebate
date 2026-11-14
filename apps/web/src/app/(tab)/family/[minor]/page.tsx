import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readMinorAccount } from '../../../../features/tab/guardian';
import { tabRoutes } from '../../../../features/tab/routes';
import { requestSampleScene } from '../../../../features/tab/sample/request-scene';
import { MinorAccount } from '../../../../ui/tab/guardian/minor-account';
import { sampleSubmit } from '../../sample-submit';

export const metadata: Metadata = { title: 'Your family' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ minor: string }>;
}) {
  const { minor } = await params;
  const account = readMinorAccount(minor, await requestSampleScene());
  if (account === null) notFound();
  return (
    <MinorAccount
      account={account}
      submit={sampleSubmit(tabRoutes.minor(minor))}
    />
  );
}
