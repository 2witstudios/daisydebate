import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { requestReleaseEnabled } from '../../../../lib/request-session';
import { LeagueRequestPage } from '../../../../ui/league-requests/league-request-page';
import { sendLeagueRequestAction } from './actions';

const description =
  'Run a league on Daisy Debate: tell us about your schools and seasons, and we will set it up with you.';

export const metadata: Metadata = {
  title: 'Talk to us about a league',
  description,
  alternates: { canonical: '/contact/league' },
};

/**
 * Public: League's "Talk to us" (PYL-17), readable and sendable signed out,
 * once `league-requests` opens (until then it does not exist). Each render
 * chooses the request's id, so sending the same form twice stores it once.
 */
export default async function LeagueRequest() {
  if (!(await requestReleaseEnabled('league-requests', null))) notFound();
  return (
    <LeagueRequestPage
      requestId={systemId.next()}
      action={sendLeagueRequestAction}
    />
  );
}
