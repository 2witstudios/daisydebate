'use server';

import { cookies } from 'next/headers';
import {
  flipRailPreference,
  parseRailPreference,
  RAIL_COOKIE,
  RAIL_COOKIE_OPTIONS,
} from '../../ui/layout/app-shell/rail-preference';

/**
 * The rail toggle's POST (ADR 0091): it flips the saved rail width —
 * setting daisy.rail=mini, or deleting the cookie so absent means extended
 * again — and Next re-renders the current route in the same response, so a
 * plain form POST works before hydration and without JavaScript. The POST
 * carries no data to validate; the cookie value is the one untrusted input
 * and parseRailPreference is its trust boundary.
 */
export async function toggleRail(): Promise<void> {
  const jar = await cookies();
  if (
    flipRailPreference(parseRailPreference(jar.get(RAIL_COOKIE)?.value)) ===
    'mini'
  )
    jar.set(RAIL_COOKIE, 'mini', RAIL_COOKIE_OPTIONS);
  else jar.delete(RAIL_COOKIE);
}
