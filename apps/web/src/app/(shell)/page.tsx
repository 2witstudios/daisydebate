import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { betaHref } from '../../features/access/decision';
import { Dashboard } from '../../ui/dashboard/dashboard';
import { HeroBanner } from '../../ui/dashboard/hero-banner/hero-banner';
import { MemberHero } from '../../ui/dashboard/member-hero/member-hero';
import { requestActiveRoom } from './active-room';
import { requestIdentity } from '../../lib/request-session';
import { requestLinkAction } from '../(bare)/sign-in/actions';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * A member's Home leads into the Lobby (or back to their Room); a visitor's
 * hero joins with the sign-in page's action, landing on this page.
 */
export default async function HomePage() {
  const identity = await requestIdentity();
  // Home leads into play, so a waitlisted account waits on the beta page.
  if (identity.state === 'waitlisted') redirect(betaHref('/'));
  return (
    <Dashboard
      hero={
        identity.state === 'member' ? (
          <MemberHero
            username={identity.username}
            activeRoom={await requestActiveRoom()}
          />
        ) : (
          <HeroBanner requestLink={requestLinkAction.bind(null, '/')} />
        )
      }
    />
  );
}
