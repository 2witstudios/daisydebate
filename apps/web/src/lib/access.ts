import type { Identity } from '@daisy/auth';
import type { SearchParams } from '../features/access/decision';
import { accessGuard } from './access-guard';
import { requestIdentity } from './request-session';

const guard = accessGuard(requestIdentity);

/**
 * Server-component guard: resolves the durable session from this request's
 * cookies and redirects when the area's requirement is unmet. Call it from
 * every guarded page (and any server entrypoint under one) with that page's
 * own path and search params, so the return trip keeps the query. The
 * requirement comes from the guarded-area table, never the caller. The
 * proxy's cookie check is only an early hint, never this check.
 */
export const requireAccess = (
  path: string,
  searchParams: Promise<SearchParams>,
): Promise<Identity> => guard.requireAccess(path, searchParams);

/**
 * The same guard for a page that answers a temporary refusal itself, as a live
 * Round's room does. A failure that may not pass still throws.
 */
export const accessOrTemporary = (
  path: string,
  searchParams: Promise<SearchParams>,
) => guard.accessOrTemporary(path, searchParams);
