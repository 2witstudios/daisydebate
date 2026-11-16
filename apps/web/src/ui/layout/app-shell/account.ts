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
      /** The label they chose besides the username (ADR 0142), or null. */
      readonly displayName: string | null;
      /** Their published profile photo, which anyone may see, or null. */
      readonly photoId: string | null;
    };

/**
 * A member's standing on each ladder, read once per request for the account
 * menu. `unavailable` when the read fails, so the menu says so instead of
 * blocking the page.
 */
export type ShellRatings =
  | {
      readonly state: 'ready';
      readonly standings: readonly MemberStanding[];
    }
  | { readonly state: 'unavailable' };
