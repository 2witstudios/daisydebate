import type { Metadata } from 'next';
import { Dashboard } from '../../ui/dashboard/dashboard';
import { HeroBanner } from '../../ui/dashboard/hero-banner/hero-banner';
import { MemberHero } from '../../ui/dashboard/member-hero/member-hero';
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
  return (
    <Dashboard
      hero={
        identity.state === 'member' ? (
          <MemberHero username={identity.username} activeRoom={null} />
        ) : (
          <HeroBanner requestLink={requestLinkAction.bind(null, '/')} />
        )
      }
    />
  );
}
