import { defaultStandingLobby } from '@daisy/protocol/lobby/eligibility';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { betaHref, RESTRICTED_HREF } from '../../features/access/decision';
import { Dashboard } from '../../ui/dashboard/dashboard';
import { HeroBanner } from '../../ui/dashboard/hero-banner/hero-banner';
import { MemberHero } from '../../ui/dashboard/member-hero/member-hero';
import { requestActiveRoom } from './active-room';
import { ResumeRound } from '../../ui/active-room/resume-round';
import { requestIdentity } from '../../lib/page-reads';
import {
  requestCompetitionAgeBand,
  requestOfficialStandingLobbies,
} from '../../features/lobby/page-reads';
import { requestLeadingLive } from '../../features/watch/page-reads';
import { requestSeasonGlance } from '../../features/leaderboard/page-reads';
import { LiveNow } from '../../ui/dashboard/live-now/live-now';
import { requestLinkAction } from '../(bare)/sign-in/actions';
import { requestPricingOpen } from './pricing/releases';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * A member's Home leads into the Lobby (or back to their Room); a visitor's
 * hero joins with the sign-in page's action, landing on this page.
 */
export default async function HomePage() {
  const identity = await requestIdentity();
  // Home leads into play, so a waitlisted account waits on the beta page and
  // a restricted one goes to its own.
  if (identity.state === 'waitlisted') redirect(betaHref('/'));
  if (identity.state === 'restricted') redirect(RESTRICTED_HREF);
  const [rounds, seasonGlance, lobbies, ageBand] = await Promise.all([
    requestLeadingLive(),
    requestSeasonGlance(),
    requestOfficialStandingLobbies(),
    requestCompetitionAgeBand(),
  ]);
  const playLobbyId = defaultStandingLobby(lobbies, ageBand)?.id ?? null;
  const liveNow = <LiveNow rounds={rounds} />;
  if (identity.state !== 'member') {
    // Only the visitor's hero links to /pricing, so only a visitor reads it.
    const pricing = await requestPricingOpen();
    return (
      <Dashboard
        audience="visitor"
        liveNow={liveNow}
        seasonGlance={seasonGlance}
        playLobbyId={playLobbyId}
        hero={
          <HeroBanner
            requestLink={requestLinkAction.bind(null, '/')}
            showPricing={pricing}
          />
        }
      />
    );
  }
  const activeRoom = await requestActiveRoom();
  return (
    <Dashboard
      audience="member"
      liveNow={liveNow}
      seasonGlance={seasonGlance}
      playLobbyId={playLobbyId}
      hero={
        <>
          <ResumeRound room={activeRoom} actorId={identity.principal.actorId} />
          <MemberHero username={identity.username} activeRoom={activeRoom} />
        </>
      }
    />
  );
}
