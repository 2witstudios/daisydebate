import type { Identity } from '@daisy/auth';
import type { ShellAccount } from '../ui/layout/app-shell/components/topbar/topbar';

/** The only fields the client shell learns: never ids, roles or permissions. */
export const shellAccount = (identity: Identity): ShellAccount =>
  identity.state === 'member'
    ? { state: 'member', username: identity.username }
    : { state: identity.state };
