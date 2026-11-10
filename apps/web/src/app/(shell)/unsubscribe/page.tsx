import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { unsubscribeViewOf } from '../../../features/notifications/email/unsubscribe-view';
import { UnsubscribePage } from '../../../ui/notifications/unsubscribe-page/unsubscribe-page';

export const metadata: Metadata = {
  title: 'Email preferences',
  robots: { index: false, follow: false },
};

/** Public: an email's own opt-out link lands here (ADR 0124). */
export default async function Unsubscribe({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  return <UnsubscribePage view={unsubscribeViewOf(await searchParams)} />;
}
