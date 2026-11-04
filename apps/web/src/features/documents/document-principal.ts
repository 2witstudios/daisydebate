import type { Identity } from '@daisy/auth';
import { requireMemberActor } from '../access/actor';

/** Server callers render private files only for a canonical authenticated member actor. */
export const documentPrincipalOf = (identity: Identity) =>
  identity.state === 'member' ? requireMemberActor(identity.principal) : null;
