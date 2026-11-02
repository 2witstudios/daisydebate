import { isCapacityRefusal } from '@daisy/db/capacity';
import type { AnalyticsConsent } from '@daisy/protocol';

/**
 * The viewer's stored consent, on a read that runs under every page through
 * the root layout. A refusal is reported apart from a found or empty answer:
 * it says nothing about consent, so a page goes without analytics for this
 * render rather than guess one or lose the page. Any other failure still throws.
 */
export async function readViewerConsent(
  read: (userId: string) => Promise<AnalyticsConsent | null>,
  userId: string,
) {
  try {
    return { refused: false, stored: await read(userId) };
  } catch (error) {
    if (!isCapacityRefusal(error)) throw error;
    return { refused: true, stored: null };
  }
}
