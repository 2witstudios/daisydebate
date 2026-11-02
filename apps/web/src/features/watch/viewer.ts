import { claimedUsername, type Identity } from '@daisy/auth';
import type { WatchViewer } from './round';

/**
 * Who is watching, from the request's identity. Watching needs no account; a
 * public name is what lets a viewer be recognised in their own Rounds and
 * interact, so anyone without one is a visitor here.
 */
export const viewerOf = (identity: Identity): WatchViewer => {
  const handle = claimedUsername(identity);
  return handle === null ? { signedIn: false } : { signedIn: true, handle };
};
