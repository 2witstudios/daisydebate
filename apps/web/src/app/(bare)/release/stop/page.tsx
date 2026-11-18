import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { ReleaseFrame } from '../../../../ui/media-releases/parent/release-frame';
import { StopRequests } from '../../../../ui/media-releases/parent/link-forms';
import { stopRequestsAction } from '../actions';

export const metadata: Metadata = {
  title: 'Stop release requests',
  referrer: 'same-origin',
  robots: { index: false, follow: false },
};

const valueOf = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value.slice(0, 128) : '';

/**
 * "Don't send me release requests" (ADR 0151): open whatever the release
 * flag says, because an opt-out always works. The route checks the link's
 * keyed token; this page only asks for the click.
 */
export default async function StopReleaseRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  return (
    <ReleaseFrame>
      <StopRequests
        stop={stopRequestsAction.bind(
          null,
          valueOf(query['a']),
          valueOf(query['t']),
        )}
      />
    </ReleaseFrame>
  );
}
