import type { Identity } from '@daisy/auth';
import { watchViewer } from './debate-source';
import type { WatchViewer } from './debate';

/**
 * Who is watching, from the request's identity. Any account may spectate
 * (sockets need a signed-in ticket, ADR 0031); a visitor with none may not.
 */
export const viewerOf = (identity: Identity): WatchViewer =>
  watchViewer(identity.state === 'member' || identity.state === 'provisional');
