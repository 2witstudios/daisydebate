import type { ProvisionalLinkPurposes } from '@daisy/db';
import type { RetentionTarget } from './retention-target';
import { flagRetentionTargets } from '../features/flags/retention';
import {
  verificationRetentionTarget,
  sessionRetentionTarget,
  provisionalUserRetentionTarget,
} from '../features/auth/retention';
import { childAccountRequestRetentionTarget } from '../features/parental-controls/retention';
import { outboxRetentionTarget } from '../features/realtime/retention';
import { roomCommandRetentionTarget } from '../features/room-runtime/retention';
import {
  roundCommandRetentionTarget,
  transcriptRetentionTarget,
} from '../features/round-runtime/retention';
import { checkInRetentionTarget } from '../features/attendance/retention';
import { availabilityRetentionTargets } from '../features/availability/retention';
import {
  deliveryRetentionTargets,
  mailIntentRetentionTarget,
} from '../features/mail/retention';
import { seatInvitationRetentionTarget } from '../features/clubs/retention';
import { leagueRequestRetentionTarget } from '../features/league-requests/retention';
import { supportMessageRetentionTarget } from '../features/support/retention';
import { mediaReleaseRetentionTargets } from '../features/media-releases/retention';
import { judgingRetentionTargets } from '../features/round-judging/retention';
import { roundAnalysisRetentionTarget } from '../features/round-analysis/retention';
import { contactRetentionTargets } from '../features/contacts/retention';
import {
  notificationRetentionTarget,
  digestRetentionTarget,
} from '../features/notifications/retention';
import { unreadMailRetentionTarget } from '../features/messaging/retention';
import { roomInvitationRetentionTarget } from '../features/room-invitations/retention';
import { watchHistoryRetentionTarget } from '../features/watch-history/retention';
import { spectatorChatRetentionTarget } from '../features/spectating/retention';
import { audienceReactionRetentionTarget } from '../features/audience-reactions/retention';
import { floorRetentionTargets } from '../features/messaging/round-floor/retention';
import { roomCommunityRetentionTargets } from '../features/messaging/room-community/retention';
import { challengeRetentionTarget } from '../features/challenges/retention';
import { reportRetentionTarget } from '../features/reports/retention';
import { moderationRetentionTarget } from '../features/moderation/retention';
import { onlinePresenceRetentionTarget } from '../features/presence/retention';

type RetentionDatabase = Parameters<typeof flagRetentionTargets>[0] &
  Parameters<typeof verificationRetentionTarget>[0] &
  Parameters<typeof outboxRetentionTarget>[0] &
  Parameters<typeof sessionRetentionTarget>[0] &
  Parameters<typeof provisionalUserRetentionTarget>[0] &
  Parameters<typeof childAccountRequestRetentionTarget>[0] &
  Parameters<typeof roomCommandRetentionTarget>[0] &
  Parameters<typeof roundCommandRetentionTarget>[0] &
  Parameters<typeof checkInRetentionTarget>[0] &
  Parameters<typeof availabilityRetentionTargets>[0] &
  Parameters<typeof deliveryRetentionTargets>[0] &
  Parameters<typeof seatInvitationRetentionTarget>[0] &
  Parameters<typeof leagueRequestRetentionTarget>[0] &
  Parameters<typeof supportMessageRetentionTarget>[0] &
  Parameters<typeof mediaReleaseRetentionTargets>[0] &
  Parameters<typeof mailIntentRetentionTarget>[0] &
  Parameters<typeof transcriptRetentionTarget>[0] &
  Parameters<typeof judgingRetentionTargets>[0] &
  Parameters<typeof roundAnalysisRetentionTarget>[0] &
  Parameters<typeof contactRetentionTargets>[0] &
  Parameters<typeof notificationRetentionTarget>[0] &
  Parameters<typeof unreadMailRetentionTarget>[0] &
  Parameters<typeof digestRetentionTarget>[0] &
  Parameters<typeof roomInvitationRetentionTarget>[0] &
  Parameters<typeof watchHistoryRetentionTarget>[0] &
  Parameters<typeof spectatorChatRetentionTarget>[0] &
  Parameters<typeof audienceReactionRetentionTarget>[0] &
  Parameters<typeof floorRetentionTargets>[0] &
  Parameters<typeof roomCommunityRetentionTargets>[0] &
  Parameters<typeof challengeRetentionTarget>[0] &
  Parameters<typeof reportRetentionTarget>[0] &
  Parameters<typeof moderationRetentionTarget>[0];

/** Compose the feature targets in sweep order. */
export function retentionTargets({
  database,
  redis,
  provisionalLinks,
}: {
  readonly database: RetentionDatabase;
  readonly redis: Parameters<typeof onlinePresenceRetentionTarget>[0];
  /** The link purposes the abandoned-account sweep clears; no hash key. */
  readonly provisionalLinks: ProvisionalLinkPurposes;
}): readonly RetentionTarget[] {
  return [
    ...flagRetentionTargets(database),
    verificationRetentionTarget(database),
    outboxRetentionTarget(database),
    sessionRetentionTarget(database),
    provisionalUserRetentionTarget(database, provisionalLinks),
    childAccountRequestRetentionTarget(database),
    roomCommandRetentionTarget(database),
    roundCommandRetentionTarget(database),
    checkInRetentionTarget(database),
    ...availabilityRetentionTargets(database),
    ...deliveryRetentionTargets(database),
    seatInvitationRetentionTarget(database),
    leagueRequestRetentionTarget(database),
    supportMessageRetentionTarget(database),
    ...mediaReleaseRetentionTargets(database),
    mailIntentRetentionTarget(database),
    transcriptRetentionTarget(database),
    ...judgingRetentionTargets(database),
    roundAnalysisRetentionTarget(database),
    ...contactRetentionTargets(database),
    notificationRetentionTarget(database),
    unreadMailRetentionTarget(database),
    digestRetentionTarget(database),
    roomInvitationRetentionTarget(database),
    watchHistoryRetentionTarget(database),
    spectatorChatRetentionTarget(database),
    audienceReactionRetentionTarget(database),
    ...floorRetentionTargets(database),
    ...roomCommunityRetentionTargets(database),
    challengeRetentionTarget(database),
    reportRetentionTarget(database),
    moderationRetentionTarget(database),
    onlinePresenceRetentionTarget(redis),
  ];
}
