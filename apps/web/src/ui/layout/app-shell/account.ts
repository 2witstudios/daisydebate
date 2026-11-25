import type { RatingDivision } from '@daisy/protocol/ladder';
import type { MemberStanding } from '../../../features/ratings/read-member';

/** Who the shell is showing: derived on the server from the durable session. */
export type ShellAccount =
  | { readonly state: 'anonymous' }
  | { readonly state: 'provisional' }
  /** Signed in with a username, waiting for beta access (ADR 0075). */
  | { readonly state: 'waitlisted' }
  /** Signed in under a suspension or ban (ADR 0103). */
  | { readonly state: 'restricted' }
  | {
      readonly state: 'member';
      readonly username: string;
      /** The label they chose besides the username (ADR 0143), or null. */
      readonly displayName: string | null;
      /** Their published profile photo, which anyone may see, or null. */
      readonly photoId: string | null;
    };

/**
 * A member's standing on each Daisy ladder, read once per request for their
 * card's headline rating. `unavailable` when the read fails, so the card shows
 * no rating instead of blocking the page.
 */
export type ShellRatings =
  | {
      readonly state: 'ready';
      readonly standings: readonly MemberStanding[];
      /** The division they debate on (ADR 0147); null with no age on record. */
      readonly division: RatingDivision | null;
    }
  | { readonly state: 'unavailable' };
