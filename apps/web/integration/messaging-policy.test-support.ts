import { betaDmPolicy } from '@daisy/auth/social-policy';
import { messagingMemberReading } from '@daisy/auth/group-policy';

/** Exact deployed policies over isolated durable accounts, not permissive fixture evidence. */
export const messagingFixturePosting = betaDmPolicy;
export const messagingFixtureReading = messagingMemberReading(true);
