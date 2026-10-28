import { headers } from 'next/headers';
import { presenceSettingResultSchema } from '@daisy/protocol';
import { GET } from '../../api/presence/route';

/**
 * The viewer's own presence setting for a server render, through Presence's
 * own route with this request's headers; null when refused or unavailable.
 */
export async function readPresence(): Promise<{
  readonly hidden: boolean;
} | null> {
  try {
    const response = await GET(
      new Request('http://in-process.invalid/api/presence', {
        headers: new Headers(await headers()),
      }),
    );
    if (!response.ok) return null;
    const setting = presenceSettingResultSchema.safeParse(
      await response.json(),
    );
    return setting.success ? setting.data : null;
  } catch {
    return null;
  }
}
