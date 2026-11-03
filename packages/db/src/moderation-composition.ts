import { endMemberOffers } from './challenges/frame';
import type { ModerationReactions } from './moderation/store';

/** What each capability registers to react to a restriction (ADR 0103). */
export const moderationReactions: ModerationReactions = {
  onRestricted: [endMemberOffers],
};
