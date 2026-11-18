import { processApp } from '../../server/process-app';
import {
  mediaReleaseSettingsView,
  type MediaReleaseSettingsView,
} from './settings-view';

/**
 * A youth member's media release section, or null: only on Youth – Freestyle
 * and only while the youth-publishing flag (the counsel gate) is open.
 */
export async function readMediaReleaseSettings(input: {
  readonly userId: string;
  readonly released: boolean;
}): Promise<MediaReleaseSettingsView | null> {
  if (!input.released) return null;
  const read = await processApp().database.mediaReleases.readMinorRelease(
    input.userId,
  );
  return read.division === 'youth' ? mediaReleaseSettingsView(read) : null;
}
