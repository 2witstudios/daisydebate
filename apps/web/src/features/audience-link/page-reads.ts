import { headers } from 'next/headers';
import { type Identity } from '@daisy/auth';
import { presentedLinkHash } from './audience-link';
import { readHostedAudienceLink } from './issue-link';
import { requestApp } from '../../lib/page-reads';

/** A Round's link standing, for the member who hosts it; null for anyone else. */
export const requestHostedAudienceLink = async (
  roundId: string,
  identity: Identity,
) =>
  identity.state === 'member'
    ? readHostedAudienceLink(requestApp().database, {
        roundId,
        caller: {
          userId: identity.principal.userId,
          actorId: identity.principal.actorId,
        },
      })
    : null;

/** The hash of the audience link this render's browser holds for a Round. */
export const requestPresentedLink = async (roundId: string) =>
  presentedLinkHash((await headers()).get('cookie'), roundId);
